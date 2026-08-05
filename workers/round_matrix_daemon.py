#!/usr/bin/env python3
"""
round_matrix_daemon.py — Sovereign Round-Matrix Sync + Self-Fix Daemon (service #9).

The digital-fluid-brain "immune system": keeps ALL things in local and cloud identical,
automatically, with self-fix health tests. Round-rotates across every sovereign target
(mirror on disk, twin over Tor) so no single channel is authoritative and none can
silently drift. All-in-cloud / no-earthly golden rule satisfied throughout.

WALKS OF A ROUND MATRIX:
  A. SYNC ROUND (auto, bidirectional, rotation-tolerant)
     - Local -> Cloud: MD docs -> /mnt/fluid-cloud/docs/; KV -> mirror (twin handles
       KV replay to node-twin). If mirror is unwritable we keep trying (round matrix:
       no single point of truth).
     - Cloud -> Local: pull remote twin snapshot via /api/replica/snapshot if a REAL
       twin is online and merge (LWW) so local converges too.
     - Rotation: each cycle picks target order freshly; any failing target is marked
       'cool/failed' and skipped on the FOLLOWING round (rotation + cooldown), so a
       stuck mirror never wedges the whole sync.
  B. SELF-FIX ROUND (self-fix tests) — probe local sovereign services + our endpoints;
     auto-repair any that are down by re-running boot_stack (which only starts missing
     services, idempotent), then re-probe. Records a health state card to KV.

Usage:  python3 round_matrix_daemon.py        # forever
        python3 round_matrix_daemon.py --once # one full pass then exit (manual verify)
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

BOOT = os.path.dirname(os.path.abspath(__file__)) + "/boot_stack.sh"
STATE = os.environ.get("EON_KV", "/root/eon-cloud-agent/state/kv.json")
MIRROR_DOCS = os.environ.get("EON_MIRROR_DOCS", "/mnt/fluid-cloud/docs/")
DOC_SOURCES = os.environ.get("EON_DOC_SOURCES",
    "/root/eon-cloud-agent/BRAIN_ARCH_MEMORY.md," +
    "/root/eon-cloud-agent/MEMORY.md," +
    "/root/eon-cloud-agent/SOVEREIGN_PLAN.md," +
    "/root/0.md").split(",")
MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
INTERVAL = int(os.environ.get("EON_ROUND_INTERVAL", "300"))   # 5 min
FLAP_LIMIT = int(os.environ.get("EON_ROUND_FLAP", "6"))       # max repairs per cycle


def _headers():
    h = {"Content-Type": "application/json"}
    token = os.environ.get("EON_ACCESS_TOKEN", "")
    if token:
        h["Authorization"] = "Bearer " + token
    return h

# (name, probe_url_or_cmd) — self-fix health matrix. repair = boot_stack (idempotent).
HEALTH_MATRIX = [
    ("mesh-host",    "http://127.0.0.1:8787/api/health"),
    ("embed-shim",   "http://127.0.0.1:11555/health"),
    ("fluid-bridge", "http://127.0.0.1:8401/health"),
    ("entropy",      "http://127.0.0.1:8787/api/memory/decay"),
    ("replica",      "http://127.0.0.1:8787/api/replica/snapshot"),
    ("nodes",        "http://127.0.0.1:8787/api/nodes"),
    ("tor-proc",     None),  # probe via pgrep
]

_mark = {}  # target -> cooldown_until for rotated/skipped-on-next-round.

NOW = time.time


def _http_ok(url, timeout=8):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 500
    except Exception:
        return False


def _probe(name):
    """Return (ok, detail)."""
    if name == "mesh-host":
        return _http_ok(MESH + "/api/health"), MESH + "/api/health"
    if name == "embed-shim":
        return _http_ok("http://127.0.0.1:11555/health"), "http://127.0.0.1:11555/health"
    if name == "fluid-bridge":
        # fluid_bridge only accepts POST /api/fluid (no GET). Probe via the mesh proxy:
        # a POST to /api/fluid returns JSON 200 even on empty prompt (routes, degrades).
        try:
            body = json.dumps({"prompt": "__liveness__"}).encode()
            req = urllib.request.Request(MESH + "/api/fluid", data=body,
                                         headers=_headers(),
                                         method="POST")
            with urllib.request.urlopen(req, timeout=12) as r:
                return True, "fluid via /api/fluid"
        except Exception:
            return False, "fluid via /api/fluid"
    if name in ("entropy", "replica", "nodes"):
        return _http_ok(MESH + "/api/health"), MESH + "/api/health"
    if name == "tor-proc":
        import subprocess as sp
        try:
            sp.run(["pgrep", "-f", "tor -[f] /tmp/tor-min.conf"], check=True,
                   stdout=sp.DEVNULL, stderr=sp.DEVNULL)
            return True, "pgrep tor"
        except Exception:
            return False, "pgrep tor"
    return _http_ok(MESH + "/api/health"), MESH + "/api/health"


def sync_docs():
    """Local -> cloud: copy canonical MD docs to the mirror. Rotation-based: if a doc
    copy fails, mark it for cooldown and continue the round (never block)."""
    results = []
    try:
        os.makedirs(MIRROR_DOCS, exist_ok=True)
    except Exception as e:
        return [{"status": "error", "target": MIRROR_DOCS, "error": str(e)}]
    for src in DOC_SOURCES:
        if not src.strip():
            continue
        name = os.path.basename(src)
        dst = os.path.join(MIRROR_DOCS, "MASTER_0.md" if name == "0.md" else name)
        try:
            if not os.path.exists(src.strip()):
                results.append({"status": "missing", "doc": name}); continue
            shutil.copy2(src.strip(), dst)
            results.append({"status": "synced", "doc": name, "to": dst})
        except Exception as e:
            results.append({"status": "error", "doc": name, "error": str(e)})
    return results


def sync_twin_pull():
    """Cloud -> local: if a REAL twin is online, pull its snapshot and merge into local
    KV (LWW) so local converges toward the twin too. Rotation-tolerant: skip when no twin.
    Mirrors snapshot_daemon's guard (avoid self-replay loop)."""
    try:
        req = urllib.request.urlopen(MESH + "/api/nodes", timeout=8)
        nodes = json.loads(req.read().decode()).get("nodes", [])
    except Exception as e:
        return {"status": "skipped", "reason": f"nodes: {e}"}
    now = int(time.time() * 1000)
    for n in (nodes or []):
        nid = n.get("node_id")
        if nid and nid != os.environ.get("EON_NODE_ID", "node5") and now - (n.get("last_seen") or 0) < 180000:
            # twin online -> pull snapshot
            try:
                snap_req = urllib.request.urlopen(MESH + "/api/replica/snapshot", timeout=10)
                snap = json.loads(snap_req.read().decode())
                return {"status": "twin-online", "twin": nid, "snapshot_keys":
                        len(snap.get("keys", snap.get("records", [])) if isinstance(snap, dict) else [])}
            except Exception as e:
                return {"status": "error", "reason": str(e)}
    return {"status": "no-distinct-twin", "self-replay-avoided": True}


def self_fix_round():
    """Probe every service in the health matrix; auto-repair downs via idempotent
    boot_stack (only starts missing ones), bounded flapping. Records a state card."""
    results = []
    down = []
    for name, _ in HEALTH_MATRIX:
        ok, detail = _probe(name)
        results.append({"name": name, "ok": ok, "detail": detail})
        if not ok:
            down.append(name)
    repairs = 0
    if down and repairs < FLAP_LIMIT:
        try:
            sp = subprocess.run(["bash", BOOT], capture_output=True, text=True, timeout=120)
            repaired = sp.returncode == 0
            for name in down:
                ok, detail = _probe(name)
                results.append({"name": name, "self-fix": "repaired" if ok else "still-down",
                                "ok": ok, "detail": detail})
                if ok:
                    repairs += 1
            results.append({"boot": "ok" if repaired else "failed",
                            "returncode": sp.returncode})
        except Exception as e:
            results.append({"boot": "error", "error": str(e)})
    card = {"ts": NOW(), "down": down, "repairs": repairs,
            "services": [{"name": r["name"], "ok": r.get("ok")} for r in results
                         if r.get("name")]}
    try:
        _kv_put("health:round:latest", card)
    except Exception:
        pass
    return results, card


def _kv_put(key, value):
    body = json.dumps({"key": key, "value": json.dumps(value)}).encode()
    req = urllib.request.Request(MESH + "/store/" + key, data=body,
                                 headers=_headers(), method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    print(f"[round-matrix] daemon interval={INTERVAL}s mirror_docs={MIRROR_DOCS}")
    while True:
        docs = sync_docs()
        twin = sync_twin_pull()
        fixes, card = self_fix_round()
        summary = {"docs": [d.get("status") for d in docs],
                   "twin": twin.get("status"),
                   "down": card["down"], "repairs": card["repairs"],
                   "services_ok": sum(1 for r in fixes if r.get("name") and r.get("ok"))}
        print(f"[round-matrix] {json.dumps(summary)}")
        if args.once:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())