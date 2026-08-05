#!/usr/bin/env python3
"""
twin_sync.py — SECOND-NODE (Twin) sovereign sync client.
Simulates the "ubuntu/self-hosted twin": dials the PRIMARY ONION over TOR SOCKS
(no earthly broker), registers itself as a node, pulls a full snapshot, then can
push local records back via /api/replica/apply (CRDT last-write-wins by ts).

All-in-cloud: the onion host is source of truth; the twin is a mirror/compute node.

Usage:
  python3 twin_sync.py                 # register + pull snapshot + apply a test record
  python3 twin_sync.py --apply         # just push a local record (LWW test)
  TWIN_* env vars override settings.
"""
import argparse
import json
import os
import socket
import ssl
import urllib.request

ONION = os.environ.get("TWIN_ONION", "o3izfmjjt2pmsgauio7fau3ykiwm5ion4ltojv7zegdpp7n74tfqsqad.onion")
NODE_ID = os.environ.get("TWIN_NODE_ID", "node-twin")
SOCKS = os.environ.get("TWIN_SOCKS", "127.0.0.1:9050")

# HTTP proxied through Tor SOCKS5 (SOCKS5h => remote DNS over Tor, onion-safe).
class Socks5Handler:
    def __init__(self, host, port):
        self.host, self.port = host, port

    def open(self, url, timeout=60):
        data = url
        host, port = url.netloc, 80
        if url.scheme == "http":
            pass
        else:
            raise ValueError("only http-over-Tor supported")
        s = socket.create_connection((self.host.split(":")[0], 9050), timeout)
        # SOCKS5 no-auth handshake
        s.sendall(b"\x05\x01\x00")
        r = s.recv(2)
        if r != b"\x05\x00":
            s.close(); raise IOError("socks handshake failed")
        hb = url.hostname.encode()
        if len(hb) > 255:
            s.close(); raise IOError("host too long")
        s.sendall(b"\x05\x01\x00\x03" + bytes([len(hb)]) + hb + (url.port or 80).to_bytes(2, "big"))
        r = s.recv(10)
        if r[1] != 0:
            s.close(); raise IOError("socks connect failed")
        return s


def _dechunk(raw):
    """Decode HTTP chunked transfer encoding: 'len\\r\\n data \\r\\n ... 0\\r\\n\\r\\n'."""
    out = b""
    i = 0
    try:
        while i < len(raw):
            j = raw.index(b"\r\n", i)
            size = int(raw[i:j], 16)
            i = j + 2
            if size == 0:
                break
            out += raw[i:i + size]
            i += size + 2
        return out
    except Exception:
        return raw


def _tor_request(method, path, body=None, timeout=60):
    """Plain-text HTTP over the Tor SOCKS tunnel to the onion-only service."""
    s = socket.create_connection(("127.0.0.1", 9050), timeout)
    s.sendall(b"\x05\x01\x00"); r = s.recv(2)
    hb = ONION.encode()
    s.sendall(b"\x05\x01\x00\x03" + bytes([len(hb)]) + hb + (80).to_bytes(2, "big"))
    r = s.recv(10)
    if len(r) < 2 or r[1] != 0:
        s.close(); raise IOError("tor connect failed")
    payload = body.encode() if body else b""
    req = (f"{method} {path} HTTP/1.1\r\nHost: {ONION}\r\n"
           f"Content-Type: application/json\r\nContent-Length: {len(payload)}\r\n"
           f"Connection: close\r\nX-Node-Id: {NODE_ID}\r\n\r\n")
    s.sendall(req.encode() + payload)
    resp = b""
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        resp += chunk
    s.close()
    head, _, body = resp.partition(b"\r\n\r\n")
    if b"200" not in head.split(b"\r\n")[0]:
        return {"error": head.decode(errors="ignore")}
    if b"transfer-encoding: chunked" in head.lower() or b"transfer-encoding:chunked" in head.lower():
        body = _dechunk(body)
    try:
        return json.loads(body)
    except Exception:
        return {"raw": body.decode(errors="ignore")}


def register():
    return _tor_request("POST", "/api/nodes", json.dumps({
        "node_id": NODE_ID, "name": "twin-ubuntu", "addr": ONION,
        "type": "twin-node", "capabilities": ["compute", "storage"],
    }))


def snapshot():
    return _tor_request("GET", "/api/replica/snapshot")


def apply_record(records):
    return _tor_request("POST", "/api/replica/apply", json.dumps({"records": records}))


def heartbeat():
    return _tor_request("POST", f"/api/nodes/{NODE_ID}/heartbeat", json.dumps({"load": 0.1, "mem": 0.3}))


def claim():
    return _tor_request("POST", "/api/compute/claim", json.dumps({"node_id": NODE_ID}))


def complete(task_id, result):
    return _tor_request("POST", "/api/compute/complete",
                        json.dumps({"task_id": task_id, "result": result}))


def execute_task(task):
    """Run one dispatched cloud task on the twin; a real twin would do real compute here."""
    t = task.get("type", "task")
    payload = task.get("payload", {})
    if t == "echo":
        return {"node": NODE_ID, "echo": payload.get("msg"), "status": "ok"}
    if t == "sum":
        a, b = payload.get("a", 0), payload.get("b", 0)
        return {"node": NODE_ID, "sum": a + b, "status": "ok"}
    if t == "infer":
        # real twin: route through the ghost round matrix; here return a stubbed result
        return {"node": NODE_ID, "note": "twin would route via ghost matrix", "status": "ok"}
    return {"node": NODE_ID, "status": "unhandled", "type": t}


def compute_once():
    """Claim queued tasks and execute them over Tor (the twin's compute duty)."""
    c = claim()
    tasks = c.get("tasks", []) if isinstance(c, dict) else []
    done = 0
    for task in tasks:
        print(f"[twin] executing {task.get('type')} {task.get('id')}")
        res = execute_task(task)
        cc = complete(task["id"], res)
        print("[twin] complete:", cc.get("status", cc))
        done += 1
    return done


def main2():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--compute", action="store_true", help="claim + execute + complete tasks over Tor")
    args = ap.parse_args()

    print(f"[twin] {NODE_ID} dialing {ONION} over Tor SOCKS (no earthly broker)")
    reg = register()
    print("[twin] register:", reg.get("status", reg) if isinstance(reg, dict) else reg)
    hb = heartbeat()
    print("[twin] heartbeat:", hb.get("status", hb) if isinstance(hb, dict) else hb)
    snap = snapshot()
    if isinstance(snap, dict) and "keys" in snap:
        print(f"[twin] snapshot pulled: {snap['keys']} keys")
    else:
        print("[twin] snapshot:", snap)
    if args.apply:
        rec = {"key": f"twin:{NODE_ID}:record", "value": json.dumps({"from": NODE_ID, "ts": 9999999999999}), "ts": 9999999999999}
        print("[twin] apply LWW:", apply_record([rec]))
    if args.compute:
        n = compute_once()
        print(f"[twin] executed {n} dispatched task(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main2())