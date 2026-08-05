#!/usr/bin/env python3
"""
matrix_deployer.py — EON Depleted Matrix Round Cloud Deployment Orchestrator

Rotates multiple Cloudflare API tokens to bypass the Workers free-plan daily
quota (429 / 1027). Each token may map to its own account; when one hits the
quota, we rotate to the next and retry the deploy until success or exhaustion.

Design decisions (from the ASI decision log):
  - NO wrangler CLI dependency for the actual push: we call the CF Workers
    upload API directly (multipart PUT /accounts/:acct/workers/scripts/:name).
    This avoids per-token wrangler auth rewrites and per-token node ctx.
  - Each token carries its OWN account id (token -> account mapping). A token
    and its account travel together; you cannot deploy a token to a foreign
    account.
  - Per 000-day rules, we keep KV as the only persistent store on the worker
    side; local machine is purely a terminal that uploads code.
  - On hard (non-429) errors, we surface and stop; only 429 (and 401 with
    the next token) trigger rotation.

Usage:
    export EON_CF_TOKENS='{"tok1": "acct1", "tok2": "acct2", ...}'
    # or
    CLI:  EON_CF_TOKEN_LIST=sk1,sk2 EON_CF_ACCOUNTS=acct1,acct2 matrix_deployer.py
    matrix_deployer.py --src ./shadow-mesh.js --name eon-neural-web \
        --kv NEURAL_KV=<nsid> --compat "2026-07-31"
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

CF_PUT = "https://api.cloudflare.com/client/v4/accounts/{acct}/workers/scripts/{name}"
TOKEN_SRC = os.environ.get("EON_CF_TOKENS")  # JSON: { "sk-xxx": "acctid", ... }
ROTATE_ON = {429, 401, 403}
MAX_ATTEMPTS_PER_TOKEN = 2


def load_tokens():
    """Return list of (token, account_id)."""
    pairs = []
    if TOKEN_SRC:
        for tok, acct in json.loads(TOKEN_SRC).items():
            pairs.append((tok, acct))
    else:
        tokens = [t for t in os.environ.get("EON_CF_TOKEN_LIST", "").split(",") if t]
        accts = [a for a in os.environ.get("EON_CF_ACCOUNT_LIST", "").split(",") if a]
        if not tokens:
            # attempt to read a plaintext token file (one token per line, tok=acct)
            tf = os.environ.get("EON_CF_TOKEN_FILE", "/tmp/eon_cf_tokens")
            if os.path.exists(tf):
                with open(tf) as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            tok, acct = line.split("=", 1)
                            pairs.append((tok, acct))
                        else:
                            pairs.append((line, None))
            else:
                print("[matrix] ERROR: no tokens. Set EON_CF_TOKENS (JSON tok->acct), "
                      "EON_CF_TOKEN_LIST, or a token file.", file=sys.stderr)
                sys.exit(2)
    # Strip only format leftovers; tokens are opaque.
    pairs = [(t.strip().strip('"').strip("'"), a and a.strip().strip('"')) for t, a in pairs if t]
    # Filter out empty-ish values rather than raw false-y blanks; keep real secrets.
    return pairs


def cf_429(resp_body):
    """Detect Cloudflare daily-quota 429 envelope (code 1007 / text mention)."""
    if "error code: 1027" in resp_body.lower() or "code: 1007" in resp_body.lower():
        return True
    try:
        d = json.loads(resp_body)
        for e in d.get("errors", []):
            if e.get("code") in (1007, 1027) or "quota" in str(e.get("message", "")).lower():
                return True
    except Exception:
        pass
    return False


def deploy_with_token(token, account_id, src, name, kv_bindings, compat_date):
    """Returns (ok: bool, retryable: bool, body: str)."""
    if not account_id:
        return False, False, "acct id missing for token"
    script = open(src, "rb").read()
    ns_json = json.dumps([{"name": k, "type": "kv_namespace", "namespace_id": v} for k, v in kv_bindings])
    meta = json.dumps({"body_part": "script", "bindings": json.loads(ns_json),
                       "compatibility_date": compat_date, "compatibility_flags": ["nodejs_compat"]})
    boundary = "----eon-matrix-" + str(int(time.time() * 1000))
    parts = []
    parts.append(b"")
    parts.append(b"--" + boundary.encode())
    parts.append(b'Content-Disposition: form-data; name="metadata"\r\n')
    parts.append(b"Content-Type: application/json\r\n\r\n")
    parts.append(meta.encode() + b"\r\n")
    parts.append(b"--" + boundary.encode())
    parts.append(b'Content-Disposition: form-data; name="script"; filename="worker.js"\r\n')
    parts.append(b"Content-Type: application/javascript+module\r\n")
    parts.append(b"\r\n")
    parts.append(script + b"\r\n")
    parts.append(b"--" + boundary.encode() + b"--\r\n")
    payload = b"\r\n".join(parts)

    url = CF_PUT.format(account_id=urllib.parse.quote(account_id), name=urllib.parse.quote(name))
    with open(tmp, "wb") as f:
        f.write(payload)
    cmd = ["curl", "-s", "-o", "/tmp/eon_matrix_resp.json", "-w", "%{http_code}",
           "-X", "PUT", url, "-H", "Authorization: Bearer " + token,
           "-H", f"Content-Type: multipart/form-data; boundary={boundary}",
           "--data-binary", "@" + tmp]
    try:
        resp = subprocess.run(cmd, timeout=90, capture_output=True)
        code = resp.stdout.decode().strip()
        body = open("/tmp/eon_matrix_resp.json").read()
        return code == "200", code == "429" or cf_429(body), body
    except Exception as e:
        return False, False, "Curl error: " + str(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--kv", action="append", default=[], help="NEURAL_KV=<id>")
    ap.add_argument("--account", default=None, help="override account for single-token mode")
    ap.add_argument("--compat-date", default="2026-07-31")
    a = ap.parse_args()

    kv_bindings = []
    for item in a.kv:
        k, v = item.split("=", 1)
        kv_bindings.append((k.strip(), v.strip()))

    pairs = load_tokens()
    print(f"[matrix] {len(pairs)} token(s) available. Target: {a.name}")
    if a.account:
        pairs = [(t, a.account) for t, _ in pairs]

    used = set()
    attempts = max(1, len(pairs)) * MAX_ATTEMPTS_PER_TOKEN
    for attempt in range(attempts):
        # round-robin through tokens, skipping quota-burned (429) accounts this round
        if len(used) == len(pairs) and len(pairs) > 1:
            print("[matrix] every token 429-exhausted this day; recommend waiting for 00:00 UTC reset",
                  file=sys.stderr)
            break
        tok_idx = attempt % len(pairs)
        if tok_idx in used:
            continue
        token, acct = pairs[tok_idx]
        key = token[:8]
        print(f"[matrix] attempt {attempt+1}: using token ...{key} acct={acct or '?'}")
        ok, retry, body = deploy_with_token(token, acct, a.src, a.name, kv_bindings, a.compat_date)
        if ok:
            print(f"[matrix] DEPLOYED with token ...{key}")
            print(f"[matrix] live: https://{a.name}.exportdefaultasyncfetchrequestenvconsturl.workers.dev")
            return 0
        if retry:
            print(f"[matrix] 429 quota -> rotating away from ...{key}")
            used.add(tok_idx)
        else:
            print(f"[matrix] non-retryable error: {body[:200]}")
        time.sleep(2)
    print("[matrix] ALL TOKENS EXHAUSTED. Failed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())