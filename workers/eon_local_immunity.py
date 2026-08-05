#!/usr/bin/env python3
"""
eon_local_immunity.py — Sovereign Local Auto-Repair Immune System (service #10).

Digital Immune System for the EON local machines: auto-repairs conflicts, stale state,
network drops, and code corruption WITHOUT human intervention. Lightweight (15s loop).

Golden-rule compliant (all-in-cloud, no earthly): any re-download of a corrupted source
file comes from the SOVEREIGN mirror (/mnt/fluid-cloud/docs) — NOT Cloudflare, NOT MEGA.
Tor SOCKS is OUR OWN onion's 9050 (tor-min.conf), never a third-party proxy.

VITAL SIGNS (each 15s):
  1. CONFLICT/STACK CHECK  : duplicate mesh-supervisor / daemons -> keep newest PID, kill -9 old.
  2. NETWORK CHECK         : Tor SOCKS5 127.0.0.1:9050 liveness (3 failures -> restart tor via boot_stack).
  3. PORT SANITIZER        : /tmp/eon-matrix-*.port with dead PID -> delete (no ghost ports).
  4. CODE INTEGRITY CHECK  : py_compile matrix_parallel_processor.py; if corrupt -> re-fetch
                             clean copy from the sovereign mirror, else flag for manual heal.

Logs every action to /var/log/eon_immunity.log and posts a Hippocampus memory episode on repairs.
Usage:  python3 eon_local_immunity.py        # forever
        python3 eon_local_immunity.py --once # one pass then exit (manual verify)
"""
import argparse
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

BOOT = os.path.dirname(os.path.abspath(__file__)) + "/boot_stack.sh"
MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
LOG = os.environ.get("EON_IMMUNITY_LOG", "/var/log/eon_immunity.log")
MIRROR = os.environ.get("EON_MIRROR_DIR", "/mnt/fluid-cloud/")
INTERVAL = int(os.environ.get("EON_IMMUNITY_INTERVAL", "15"))
TOR_FAIL_LIMIT = int(os.environ.get("EON_IMMUNITY_TOR_FAIL", "3"))

# daemons to de-duplicate (bracket patterns to avoid matching self/shell)
WATCH = [
    "mesh-superviso[r].sh",
    "eon_neural_agen[t].py",
    "snapshot_daemo[n].py",
    "entropy_daemo[n].py",
    "embed_shim[.]py",
    "fluid_bridg[e].py",
]

PORT_GLOB = "/tmp/eon-matrix-*.port"
CODE_TARGET = os.environ.get("EON_IMMUNITY_CODE",
    "/root/ricocoder/scripts/matrix_parallel_processor.py")
CODE_MIRROR = os.path.join(MIRROR, "docs", "matrix_parallel_processor.py")


def log(msg):
    line = f"{time.strftime('%FT%TZ', time.gmtime())} {msg}"
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(f"[immunity] {line}")


def _pgrep(pattern):
    """Return list of PIDs matching bracket pattern (excludes this shell)."""
    try:
        out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True, timeout=10)
        return [int(p) for p in out.stdout.split() if p.strip()]
    except Exception:
        return []


def check_duplicates():
    """Keep newest PID, kill older duplicates. Returns list of repairs."""
    repairs = []
    for pat in WATCH:
        pids = _pgrep(pat)
        if len(pids) > 1:
            keep = max(pids)  # newest PID
            for old in pids:
                if old != keep:
                    try:
                        subprocess.run(["kill", "-9", str(old)], timeout=5)
                        repairs.append(f"killed duplicate {pat} pid {old} (kept {keep})")
                    except Exception as e:
                        repairs.append(f"kill failed {pat} pid {old}: {e}")
    return repairs


def tor_alive():
    try:
        with socket.create_connection(("127.0.0.1", 9050), timeout=3):
            return True
    except Exception:
        return False


def sanitize_ports():
    """Delete /tmp/eon-matrix-*.port files whose PID is dead (ghost ports)."""
    repairs = []
    for path in glob.glob(PORT_GLOB):
        try:
            txt = open(path).read()
            m = re.search(r"PID\s*=\s*(\d+)", txt)
            pid = int(m.group(1)) if m else -1
            alive = pid > 0 and os.path.exists(f"/proc/{pid}")
            if not alive:
                os.remove(path)
                repairs.append(f"removed stale port file {path} (pid {pid} dead)")
        except Exception as e:
            repairs.append(f"port scan error {path}: {e}")
    return repairs


def check_code():
    """py_compile the target; if SyntaxError, re-fetch clean copy from sovereign mirror."""
    try:
        import py_compile
        py_compile.compile(CODE_TARGET, doraise=True)
        return []
    except (py_compile.PyCompileError, SyntaxError) as e:
        if os.path.exists(CODE_MIRROR):
            try:
                shutil.copy2(CODE_MIRROR, CODE_TARGET)
                py_compile.compile(CODE_TARGET, doraise=True)
                return [f"code integrity: re-fetched {CODE_TARGET} from sovereign mirror after {type(e).__name__}"]
            except Exception as e2:
                return [f"code integrity: corrupt {CODE_TARGET} ({e}); mirror restore failed: {e2}"]
        return [f"code integrity: corrupt {CODE_TARGET} ({e}); no mirror copy present"]


def restart_tor():
    """Idempotent full-stack restart (boot_stack starts tor if down)."""
    try:
        subprocess.run(["bash", BOOT], capture_output=True, text=True, timeout=120)
        return "tor restart via boot_stack"
    except Exception as e:
        return f"tor restart failed: {e}"


def memorize(text, outcome="success"):
    try:
        body = json.dumps({"text": text, "tag": "immunity",
                           "emotional_weight": 1, "outcome": outcome}).encode()
        req = urllib.request.Request(MESH + "/api/memory/episodic", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    log(f"immunity daemon start interval={INTERVAL}s watch={len(WATCH)}")
    tor_fail = 0
    while True:
        repairs = []
        repairs += check_duplicates()
        repairs += sanitize_ports()
        if tor_alive():
            tor_fail = 0
        else:
            tor_fail += 1
            if tor_fail >= TOR_FAIL_LIMIT:
                repairs.append(restart_tor())
                tor_fail = 0
        repairs += check_code()
        status = "Health OK" if not repairs else "REPAIR"
        log(f"{status} | repairs={len(repairs)} tor_fail={tor_fail}")
        for r in repairs:
            log(f"  -> {r}")
        if repairs:
            memorize("; ".join(repairs))
        if args.once:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())