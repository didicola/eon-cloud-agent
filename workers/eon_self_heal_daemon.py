#!/usr/bin/env python3
"""
eon_self_heal_daemon.py — Sovereign Autonomic Nervous System daemon (service #9).

Round-Matrix Sync + Self-Fix for the EON Cloud. Continuously:
  - SYNC:         pushes canonical state (state/kv.json) to the sovereign mirror
                  (/mnt/fluid-cloud/) and gathers cloud memory/task counts.
  - HEALTH CHECK: runs 4 diagnostics (async bug, embed shim dims, duplicate daemons,
                  mesh health).
  - AUTO-REPAIR:  fixes whatever fails (guarded code rewrite, boot_stack restart,
                  stale-duplicate kill), logs to /var/log/eon_self_heal.log.

Golden-rule compliant (all-in-cloud, no earthly): "cloud" = own Tor onion + /mnt/fluid-cloud/
mirror + :8787 sovereign worker. NEVER Cloudflare-as-truth, NEVER SQLite, NEVER
openhuman-embed.service — the embed shim is our own workers/embed_shim.py on :11555
(restarted via boot_stack.sh).

Usage:  python3 eon_self_heal_daemon.py        # forever (60s loop)
        python3 eon_self_heal_daemon.py --once # one pass then exit (manual verify)
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

BOOT = os.path.dirname(os.path.abspath(__file__)) + "/boot_stack.sh"
STATE = os.environ.get("EON_KV", "/root/eon-cloud-agent/state/kv.json")
MIRROR = os.environ.get("EON_MIRROR_DIR", "/mnt/fluid-cloud/")
MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
LOG = os.environ.get("EON_HEAL_LOG", "/var/log/eon_self_heal.log")
GHOST = os.path.dirname(os.path.abspath(__file__)) + "/ghost_matrix.py"
INTERVAL = int(os.environ.get("EON_HEAL_INTERVAL", "60"))
KEEP = int(os.environ.get("EON_HEAL_KEEP", "10"))

WATCH = ["eon_neural_agen[t].py", "snapshot_daemo[n].py", "entropy_daemo[n].py",
         "embed_shim[.]py", "mesh-superviso[r].sh"]


def log(msg):
    line = f"{time.strftime('%FT%TZ', time.gmtime())} {msg}"
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(f"[self-heal] {line}")


# ---------------- SYNC MODULE ----------------
def sync_round():
    """Push kv.json -> fluid-cloud mirror (latest + timestamped, keep N). Pull cloud counts."""
    out = {"mirror": "skip", "memory": 0, "tasks": 0}
    try:
        os.makedirs(MIRROR, exist_ok=True)
        if os.path.exists(STATE):
            ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
            shutil.copy2(STATE, os.path.join(MIRROR, f"kv.{ts}.json"))
            shutil.copy2(STATE, os.path.join(MIRROR, "kv.latest.json"))
            vers = sorted(f for f in os.listdir(MIRROR) if f.startswith("kv.") and f.endswith(".json"))
            for f in vers[:-KEEP]:
                os.remove(os.path.join(MIRROR, f))
            out["mirror"] = f"synced={ts}"
    except Exception as e:
        out["mirror"] = f"error:{e}"
    try:
        d = json.loads(urllib.request.urlopen(MESH + "/api/memory", timeout=10).read().decode())
        out["memory"] = d.get("count", 0) if isinstance(d, dict) else 0
    except Exception:
        pass
    return out


# ---------------- HEALTH CHECK MODULE ----------------
def check_async_bug():
    """Check 1: blocking time.sleep() must NOT be in ghost_matrix async scope (await ok)."""
    try:
        src = open(GHOST).read()
        if "async def call" in src:
            scope = src.split("async def call", 1)[1].split("def run_round", 1)[0]
            blocked = re.search(r"(?<!await )time\.sleep\(", scope)
            return {"ok": blocked is None, "detail": "blocking time.sleep in async" if blocked else "await asyncio.sleep clean"}
        return {"ok": True, "detail": "no async call"}
    except Exception as e:
        return {"ok": False, "detail": f"read:{e}"}


def check_embed_shim():
    """Check 2: embed shim returns 1024-dim embedding."""
    try:
        body = json.dumps({"model": "BAAI/bge-small-en-v1.5", "prompt": "test"}).encode()
        req = urllib.request.Request("http://127.0.0.1:11555/api/embeddings", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read().decode())
        dim = len(d.get("embedding", []))
        return {"ok": dim == 1024, "detail": f"shim dim={dim}"}
    except Exception as e:
        return {"ok": False, "detail": f"shim down:{e}"}


def check_duplicates():
    """Check 3: exactly 1 process for each watched daemon."""
    bad = []
    for pat in WATCH:
        try:
            out = subprocess.run(["pgrep", "-f", pat], capture_output=True, text=True, timeout=10)
            n = len([p for p in out.stdout.split() if p.strip()])
            if n > 1:
                bad.append(f"{pat}={n}")
        except Exception:
            pass
    return {"ok": not bad, "detail": "dups:" + ",".join(bad) if bad else "no-dups"}


def check_mesh():
    """Check 4: sovereign mesh /api/health."""
    try:
        d = json.loads(urllib.request.urlopen(MESH + "/api/health", timeout=8).read().decode())
        return {"ok": d.get("status") == "ok", "detail": f"mesh={d.get('status')}"}
    except Exception as e:
        return {"ok": False, "detail": f"mesh down:{e}"}


# ---------------- AUTO-REPAIR MODULE ----------------
def repair_async_bug():
    """Guarded rewrite: replace blocking time.sleep with await asyncio.sleep ONLY in async call."""
    try:
        src = open(GHOST).read()
        head, rest = src.split("async def call", 1)
        body, tail = rest.split("def run_round", 1)
        if re.search(r"(?<!await )time\.sleep\(", body):
            if "import asyncio" not in src:
                head = "import asyncio\n" + head if head.strip() else "import asyncio\n"
            new_body = re.sub(r"time\.sleep\(", "await asyncio.sleep(", body)
            open(GHOST, "w").write(head + "async def call" + new_body + "def run_round" + tail)
            return "rewrote ghost_matrix await asyncio.sleep"
        return "async scope already clean"
    except Exception as e:
        return f"async repair error:{e}"


def repair_embed_shim():
    return "ran boot_stack (restarts embed_shim)" if subprocess.run(["bash", BOOT], timeout=120).returncode == 0 else "boot_stack failed"


def repair_duplicates():
    fixed = []
    for pat in WATCH:
        try:
            out = subprocess.run(["pgrep", "-f", pat], capture_output=True, text=True, timeout=10)
            pids = [int(p) for p in out.stdout.split() if p.strip()]
            if len(pids) > 1:
                keep = max(pids)
                for old in pids:
                    if old != keep:
                        subprocess.run(["kill", "-9", str(old)], timeout=5)
                        fixed.append(f"killed dup {pat} pid {old}")
        except Exception:
            pass
    return ("; ".join(fixed)) if fixed else "no duplicates to repair"


def repair_mesh():
    return "ran boot_stack (restart mesh)" if subprocess.run(["bash", BOOT], timeout=120).returncode == 0 else "boot_stack failed"


def memorize(text):
    try:
        body = json.dumps({"text": text, "tag": "self-heal",
                           "emotional_weight": 1, "outcome": "success"}).encode()
        req = urllib.request.Request(MESH + "/api/memory/episodic", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10):
            pass
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    log(f"self-heal daemon start interval={INTERVAL}s ghost={GHOST}")
    while True:
        checks = {
            "async": check_async_bug(),
            "embed": check_embed_shim(),
            "dups": check_duplicates(),
            "mesh": check_mesh(),
        }
        fixes = []
        if not checks["async"]["ok"]:
            fixes.append(repair_async_bug())
        if not checks["embed"]["ok"]:
            fixes.append(repair_embed_shim())
        if not checks["dups"]["ok"]:
            fixes.append(repair_duplicates())
        if not checks["mesh"]["ok"]:
            fixes.append(repair_mesh())
        sync = sync_round()
        status = "Health OK" if not fixes else "REPAIR"
        line = (f"{status} | async={checks['async']['ok']} embed={checks['embed']['ok']} "
                f"dups={checks['dups']['ok']} mesh={checks['mesh']['ok']} "
                f"sync={sync['mirror']} mem={sync['memory']}")
        log(line)
        for f in fixes:
            log(f"  => {f}")
        if fixes:
            memorize("; ".join(fixes))
        if args.once:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())