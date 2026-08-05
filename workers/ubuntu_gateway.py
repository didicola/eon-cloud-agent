#!/usr/bin/env python3
"""ubuntu_gateway.py — Ubuntu-onion model gateway sidecar (service #20, :8094).

Wraps the twin Ubuntu box's hidden model door (6ww3yh...onion) as a LOCAL
OpenAI-compatible endpoint reachable by the sovereign stack. Routes every call
over the Tor SOCKS5 port (127.0.0.1:9050) — no earthly broker, no API keys.

    GET  /v1/models              -> 523 models advertised by the Ubuntu gateway
    POST /v1/chat/completions     -> forward {model, messages} -> Ubuntu onion
    GET  /health                  -> {ok, onion, models}

Local consumers (eon-blind-proxy provider chain, eon_neural_agent, infer_bridge)
simply point at http://127.0.0.1:8094/v1/... like any OpenAI-compatible server.

Run: python3 ubuntu_gateway.py            (env: EON_UBUNTU_ONION, EON_UB_GW_PORT)
"""
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ONION = os.environ.get("EON_UBUNTU_ONION",
                       "6ww3yh3rfmufriunf2jodikn3meh3mjfd7s7binezhwkiunsnmed34ad.onion")
SOCKS = os.environ.get("EON_TOR_SOCKS", "127.0.0.1:9050")
PORT = int(os.environ.get("EON_UB_GW_PORT", "8094"))
MODELS_CACHE = {"at": 0, "data": []}


def _socks_connect(host, port, timeout=60):
    sh, sp = SOCKS.split(":")
    s = socket.create_connection((sh, int(sp)), timeout)
    s.sendall(b"\x05\x01\x00")
    r = s.recv(2)
    if r != b"\x05\x00":
        s.close()
        raise IOError("socks handshake failed")
    hb = host.encode()
    if len(hb) > 255:
        s.close()
        raise IOError("host too long")
    s.sendall(b"\x05\x01\x00\x03" + bytes([len(hb)]) + hb + int(port).to_bytes(2, "big"))
    r = s.recv(10)
    if len(r) < 2 or r[1] != 0:
        s.close()
        raise IOError("socks connect failed")
    return s


def _dechunk(raw):
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


def _call(method, path, body=None, timeout=90):
    s = _socks_connect(ONION, 80, timeout)
    payload = json.dumps(body).encode() if body is not None else b""
    req = (f"{method} {path} HTTP/1.1\r\nHost: {ONION}\r\n"
           f"Content-Type: application/json\r\nContent-Length: {len(payload)}\r\n"
           f"Connection: close\r\n\r\n")
    s.sendall(req.encode() + payload)
    resp = b""
    try:
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            resp += chunk
    finally:
        s.close()
    head, _, b = resp.partition(b"\r\n\r\n")
    status = int(head.split(b"\r\n")[0].split()[1])
    if b"transfer-encoding: chunked" in head.lower():
        b = _dechunk(b)
    try:
        return status, json.loads(b)
    except Exception:
        return status, b.decode(errors="replace")


def _models():
    now = time.time()
    if MODELS_CACHE["data"] and now - MODELS_CACHE["at"] < 600:
        return MODELS_CACHE["data"]
    try:
        st, d = _call("GET", "/v1/models", timeout=60)
        if st == 200 and isinstance(d, dict):
            MODELS_CACHE["data"] = d.get("data", [])
            MODELS_CACHE["at"] = now
            return MODELS_CACHE["data"]
    except Exception:
        pass
    return MODELS_CACHE["data"]


class H(BaseHTTPRequestHandler):
    server_version = "UbuntuGateway/1.0"

    def log_message(self, *a):
        pass

    def _send(self, code, obj, ctype="application/json"):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "service": "ubuntu-onion-gateway",
                                    "onion": ONION, "models": len(_models()),
                                    "ts": int(time.time())})
        if self.path == "/v1/models":
            return self._send(200, {"object": "list", "data": _models()})
        self._send(404, {"error": "not found", "routes": ["/health", "/v1/models", "/v1/chat/completions"]})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(length).decode() or "{}")
        except Exception:
            return self._send(400, {"error": "bad json"})
        model = body.get("model", "auto")
        try:
            st, d = _call("POST", "/v1/chat/completions", body, timeout=120)
        except Exception as e:
            return self._send(502, {"error": str(e)})
        if st != 200:
            return self._send(st, d if isinstance(d, dict) else {"error": d})
        content = None
        if isinstance(d, dict):
            try:
                content = d["choices"][0]["message"]["content"]
            except Exception:
                content = d.get("reply") or d.get("content") or d
        return self._send(200, {"choices": [{"message": {"role": "assistant", "content": content}}],
                                "model": d.get("model") if isinstance(d, dict) else model,
                                "object": "chat.completion", "via": "ubuntu-onion"})


def main():
    print(f"[ubuntu-gw] serving Ubuntu onion {ONION} on 127.0.0.1:{PORT} (via SOCKS {SOCKS})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()


if __name__ == "__main__":
    main()
