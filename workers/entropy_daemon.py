#!/usr/bin/env python3
"""
entropy_daemon.py — Sovereign Entropy / Memory-Maintenance Daemon.
Prevents the Hippocampus state-space from expanding into chaos:
  - Every cycle, ages out episodes past max_age_days whose emotional_weight < threshold
    (useless memories are forgotten).
  - Applies a small per-cycle weight decay to survivors so stale experiences lose salience.
  - All-in-cloud: hits the sovereign worker /api/memory/decay, no earthly deps.
Usage:  python3 entropy_daemon.py        # forever
        python3 entropy_daemon.py --once # single pass then exit (for manual verify)
"""
import argparse
import json
import os
import time
import urllib.request

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
INTERVAL = int(os.environ.get("EON_ENTROPY_INTERVAL", "900"))  # 15 min
MAX_AGE_DAYS = int(os.environ.get("EON_ENTROPY_MAX_AGE_DAYS", "30"))


def _headers():
    h = {"Content-Type": "application/json"}
    token = os.environ.get("EON_ACCESS_TOKEN", "")
    if token:
        h["Authorization"] = "Bearer " + token
    return h
THRESHOLD = int(os.environ.get("EON_ENTROPY_THRESHOLD", "1"))  # forget weight < 1 if too old
DECAY = float(os.environ.get("EON_ENTROPY_DECAY", "0.05"))


def decay_pass():
    body = json.dumps({"max_age_days": MAX_AGE_DAYS, "threshold": THRESHOLD, "decay": DECAY})
    req = urllib.request.Request(MESH + "/api/memory/decay", data=body.encode(),
                                 headers=_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"status": "error", "error": str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    print(f"[entropy] now ({__import__('datetime').datetime.now().isoformat()}) "
          f"max_age={MAX_AGE_DAYS}d threshold={THRESHOLD} decay={DECAY}")
    while True:
        r = decay_pass()
        print(f"[entropy] {r}")
        if args.once:
            break
        time.sleep(INTERVAL)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())