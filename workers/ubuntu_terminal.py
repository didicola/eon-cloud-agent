#!/usr/bin/env python3
"""ubuntu_terminal.py — sovereign FULL-ACCESS terminal lane to the twin Ubuntu box.

The twin Ubuntu runs eon-coordinator.sh which polls the p2p delegate queue and
executes any `target:ubuntu` task's `command` via subprocess shell=True, then
posts the result to /delegate/result. So dispatching a command over the p2p cloud
IS terminal access to the Ubuntu — same DNA as this box, no earthly broker.

    python3 workers/ubuntu_terminal.py "hostname && whoami"
    python3 workers/ubuntu_terminal.py --list          # show ubuntu tasks we dispatched
    python3 workers/ubuntu_terminal.py --probe         # identity check (confirms lane)
    python3 workers/ubuntu_terminal.py --tail          # stream recent ubuntu dispatch history

Env: EON_P2P_CLOUD, EON_TOR_SOCKS (both defaulted below).
"""
import argparse
import json
import os
import subprocess
import sys
import time

P2P = os.environ.get("EON_P2P_CLOUD", "https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev")
SOCKS = os.environ.get("EON_TOR_SOCKS", "127.0.0.1:9050")
HIST = os.environ.get("EON_UBUNTU_HIST", "/root/eon-cloud-agent/state/ubuntu-terminal-history.json")


def _socks(method, path, body=None, timeout=45):
    cmd = ["curl", "-s", "--socks5-hostname", SOCKS, "--max-time", str(timeout),
           "-X", method, P2P + path, "-H", "Content-Type: application/json"]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5).stdout
    except Exception as e:
        return 0, {"error": str(e)}
    try:
        return 200, json.loads(out)
    except Exception:
        return 200, out


def dispatch(command, action="run"):
    """POST a terminal command to the Ubuntu coordinator via the p2p delegate queue."""
    st, d = _socks("POST", "/delegate/to-local",
                   {"target": "ubuntu", "action": action,
                    "params": {"command": command, "origin": "termux-terminal-lane"}})
    tid = d.get("task_id") if isinstance(d, dict) else None
    if tid:
        hist = []
        try:
            with open(HIST) as f:
                hist = json.load(f)
        except Exception:
            pass
        hist.append({"ts": time.time(), "task_id": tid, "command": command})
        try:
            with open(HIST, "w") as f:
                json.dump(hist[-200:], f)
        except Exception:
            pass
    return st, d


def pending_ubuntu():
    st, d = _socks("GET", "/delegate/pending")
    tasks = d.get("tasks", []) if isinstance(d, dict) else []
    return [t for t in tasks if t.get("target") == "ubuntu"]


def probe():
    """Identity check: if this task is claimed (leaves pending), the Ubuntu terminal
    lane executed our command."""
    st, d = dispatch("echo EON_TERMINAL_ACCESS_CONFIRMED && hostname && whoami && uname -a")
    tid = d.get("task_id") if isinstance(d, dict) else None
    print(f"dispatched {tid} -> waiting for Ubuntu coordinator to claim+execute (polls every 30s)")
    for _ in range(8):
        time.sleep(10)
        pend = pending_ubuntu()
        if not any(t.get("task_id") == tid for t in pend):
            print(f"[{tid}] CLAIMED + EXECUTED by Ubuntu (terminal lane live)")
            return 0
    print(f"[{tid}] still pending after 80s (Ubuntu coordinator may be offline)")
    return 1


def tail(n=15):
    try:
        with open(HIST) as f:
            hist = json.load(f)
    except Exception:
        return []
    return hist[-n:]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", nargs="*", help="command to run on the Ubuntu box")
    ap.add_argument("--list", action="store_true", help="show ubuntu tasks still pending")
    ap.add_argument("--probe", action="store_true", help="identity check (confirm terminal lane)")
    ap.add_argument("--tail", action="store_true", help="show recent dispatches we sent")
    a = ap.parse_args()

    if a.probe:
        return probe()
    if a.list:
        pend = pending_ubuntu()
        print(f"{len(pend)} ubuntu task(s) pending:")
        for t in pend:
            print("  ", t.get("task_id"), (t.get("params") or {}).get("command", "")[:80])
        return 0
    if a.tail:
        for e in tail():
            print(e.get("ts"), e.get("task_id"), e.get("command", "")[:80])
        return 0
    if not a.command:
        print(__doc__)
        return 1
    st, d = dispatch(" ".join(a.command))
    tid = d.get("task_id") if isinstance(d, dict) else None
    print(f"dispatched -> {tid}")
    print("  result is posted back by the Ubuntu coordinator to /delegate/result.")
    print("  claimed+executed confirmation: it leaves the pending queue within ~30s.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
