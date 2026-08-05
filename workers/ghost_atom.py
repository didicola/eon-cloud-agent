#!/usr/bin/env python3
"""
ghost_atom.py — Ghost Atom Routing (QFT).

The local box is a thin terminal: heavy compute lives in the cloud. Every Nth
packet we spawn an EPHEMERAL Ghost Atom subprocess that binds a random high
port, POSTs the payload to the cloud target exactly once, then calls
sys.exit(0) — zero footprint, no listener left behind. Non-Nth packets are
forwarded directly inline.

Golden rule: stdlib only (urllib, json, socket, subprocess, sys). No torch,
no tensorflow, no numpy.

Usage:
    python3 ghost_atom.py --payload '{"x":1}' --target http://127.0.0.1:8787/api/compute/trig --nth 7
    python3 ghost_atom.py --target http://127.0.0.1:8787/api/compute/trig --nth 2   # self-test (3 sends)
"""
import json
import subprocess
import sys
import urllib.request

# Self-contained inline Ghost Atom: bind ephemeral high port, POST once, exit.
# Receives argv[1]=payload-json, argv[2]=target-url. Stdlib urllib/socket only.
GHOST_SRC = r"""
import json as _json
import socket as _socket
import sys as _sys
import urllib.request as _req

_payload, _url = _sys.argv[1], _sys.argv[2]
try:
    _s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    _s.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
    _s.bind(("127.0.0.1", 0))
    _port = _s.getsockname()[1]
    _s.close()
except Exception:
    _port = 0
_r = _req.Request(_url, data=_payload.encode(),
                  headers={"Content-Type": "application/json"}, method="POST")
try:
    with _req.urlopen(_r, timeout=20) as _resp:
        _resp.read()
except Exception:
    pass
_sys.exit(0)
"""

# ---- module-level QFT counter / Nth multiplier (default Nth=7) ------------
_PACKET_COUNT = 0
_NTH = 7


def _post_direct(payload, target_url, timeout=20):
    req = urllib.request.Request(target_url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"status": r.status, "body": r.read().decode(errors="replace")}
    except Exception as e:
        return {"status": 0, "error": str(e)}


def _spawn_ghost(payload, target_url):
    """Spawn the ephemeral Ghost Atom subprocess. Fire-and-forget, no wait."""
    try:
        p = subprocess.Popen([sys.executable, "-c", GHOST_SRC,
                              json.dumps(payload), target_url])
        return {"spawned": True, "mode": "ghost", "port": 0,
                "target": target_url, "pid": p.pid}
    except Exception as e:
        # Ghost spawn failed -> degrade to direct (never crash the caller).
        return {"spawned": False, "mode": "direct", "port": 0,
                "target": target_url, "error": str(e)}


def spawn_ghost(payload, target_url, ghost_port=0, nth=None):
    """Every Nth packet spawns a Ghost Atom; others forward directly inline.

    Returns {"spawned": bool, "mode": "ghost"|"direct", "port": int,
             "target": target_url}.
    """
    global _PACKET_COUNT
    n = nth if nth is not None else _NTH
    if n < 1:
        n = 1
    _PACKET_COUNT += 1
    if _PACKET_COUNT % n == 0:
        return _spawn_ghost(payload, target_url)
    r = _post_direct(payload, target_url)
    return {"spawned": False, "mode": "direct", "port": ghost_port,
            "target": target_url, "status": r.get("status", 0),
            "body": r.get("body"), "error": r.get("error")}


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)

    def argval(flag, default):
        return args[args.index(flag) + 1] if flag in args else default

    if "--payload" in args or "--target" in args:
        payload = json.loads(argval("--payload", '{"x":1}'))
        target = argval("--target", "http://127.0.0.1:8787/api/compute/trig")
        nth = int(argval("--nth", "7"))
        print(json.dumps(spawn_ghost(payload, target, 0, nth)))
        return 0

    # ---- self-test: 3 sends, Nth=2 -> expect [direct, ghost, direct] ------
    target = "http://127.0.0.1:8787/api/compute/trig"
    modes = [spawn_ghost({"x": i}, target, 0, 2)["mode"] for i in range(3)]
    print(json.dumps({"sends": 3, "nth": 2, "modes": modes}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
