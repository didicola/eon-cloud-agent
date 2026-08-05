#!/usr/bin/env python3
"""lan_sync_server.py — sovereign LAN file-sync server for the twin Ubuntu box.

Serves the ENTIRE EON arch tree (this termux box) over the local network so a
second Ubuntu on the same LAN can browse it, read any file, and push changes
back (file writes go through an atomic replace). All stdlib, no earthly deps.

    python3 lan_sync_server.py --port 8788 --bind 0.0.0.0 --root /root/eon-cloud-agent

Endpoints (all JSON unless noted):
    GET  /browse?path=workers        -> directory listing (dirs + files + sizes + mtime)
    GET  /read?path=workers/mesh-host.js  -> file contents (text) or 404
    GET  /                 -> simple browse index page
    PUT  /write?path=workers/x.py   -> write file (BODY = new content) [token-gated]
    POST /write?path=...            -> same, form/content body [token-gated]
    POST /make?path=workers/new.py  -> create file [token-gated]
    POST /mkdir?path=workers/sub    -> create dir [token-gated]
    POST /delete?path=...           -> remove file (not dirs) [token-gated]
    GET  /health                    -> {ok:true,root,host,port}

Security: reads are open on the LAN (matching the mesh's read-open posture);
writes/creates/deletes require Authorization: Bearer <mesh token>. The token is
read from state/.mesh-token.env or env EON_ACCESS_TOKEN (same as the mesh gate).
Root is locked to the arch dir; any path escaping it via .. is rejected.
"""
import argparse
import json
import os
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_ROOT = "/root/eon-cloud-agent"


def load_token():
    token = os.environ.get("EON_ACCESS_TOKEN", "")
    if token:
        return token
    for p in ("state/.mesh-token.env", "/root/eon-cloud-agent/state/.mesh-token.env"):
        try:
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("EON_ACCESS_TOKEN="):
                        return line.split("=", 1)[1]
        except OSError:
            continue
    return ""


TOKEN = load_token()
ROOT = os.environ.get("EON_LAN_ROOT", DEFAULT_ROOT)


def _resolve(path):
    """Resolve a URL path to a real path inside ROOT; None if it escapes."""
    if not path:
        return ROOT
    full = os.path.normpath(os.path.join(ROOT, path))
    if full != ROOT and not full.startswith(ROOT + os.sep):
        return None
    return full


class Handler(BaseHTTPRequestHandler):
    server_version = "EON-LanSync/1.0"

    def log_message(self, fmt, *args):
        print("[lansync] %s %s" % (self.address_string(), fmt % args), flush=True)

    # ── helpers ──
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self):
        if not TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        return auth == "Bearer " + TOKEN

    def _deny(self):
        self._send(401, {"error": "unauthorized: missing/invalid bearer token"})

    # ── routing ──
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        p = u.path
        if p == "/health":
            return self._send(200, {"ok": True, "service": "eon-lan-sync",
                                    "root": ROOT, "ts": int(time.time())})
        if p == "/":
            return self._index()
        if p == "/browse":
            return self._browse(q.get("path", [""])[0])
        if p == "/read":
            return self._read(q.get("path", [""])[0])
        self._send(404, {"error": "not found", "routes": ["/", "/browse", "/read", "/write", "/make", "/mkdir", "/delete", "/health"]})

    def do_PUT(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        p = u.path
        if not self._authed():
            return self._deny()
        if p == "/write":
            return self._write(q.get("path", [""])[0])
        self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        p = u.path
        if not self._authed():
            return self._deny()
        if p == "/write":
            return self._write(q.get("path", [""])[0])
        if p == "/make":
            return self._make(q.get("path", [""])[0])
        if p == "/mkdir":
            return self._mkdir(q.get("path", [""])[0])
        if p == "/delete":
            return self._delete(q.get("path", [""])[0])
        self._send(404, {"error": "not found"})

    # ── implementations ──
    def _index(self):
        html = """<!doctype html><html><head><meta charset="utf-8">
<title>EON LAN Sync</title><style>
body{font-family:monospace;background:#111;color:#eee;margin:2rem}
a{color:#7df}a:hover{color:#4af}table{border-collapse:collapse}
td,th{padding:.3rem .8rem;border-bottom:1px solid #333;text-align:left}
.g{color:#9f9}.r{color:#f88}
</style></head><body>
<h1>EON LAN Sync — full arch browser</h1>
<p>root: <code>%s</code> &nbsp;|&nbsp; <a href="/browse?path=">browse /</a>
&nbsp;|&nbsp; <a href="/health">health</a></p>
<pre class="g">writes require: curl -X PUT http://THIS_HOST:8788/write?path=workers/foo.py \\
  -H "Authorization: Bearer &lt;mesh-token&gt;" --data-binary @foo.py</pre>
</body></html>""" % ROOT
        self._send(200, html, "text/html")

    def _browse(self, path):
        full = _resolve(path)
        if full is None:
            return self._send(403, {"error": "path escapes root"})
        if not os.path.exists(full):
            return self._send(404, {"error": "no such path", "path": path})
        if os.path.isfile(full):
            return self._read(path)
        try:
            entries = []
            for name in sorted(os.listdir(full)):
                fp = os.path.join(full, name)
                st = os.stat(fp)
                entries.append({
                    "name": name,
                    "type": "dir" if os.path.isdir(fp) else "file",
                    "size": st.st_size if os.path.isfile(fp) else None,
                    "mtime": st.st_mtime,
                    "rel": os.path.join(path, name).lstrip("/") if path else name,
                })
        except OSError as e:
            return self._send(500, {"error": str(e)})
        return self._send(200, {"path": path or "/", "entries": entries})

    def _read(self, path):
        full = _resolve(path)
        if full is None:
            return self._send(403, {"error": "path escapes root"})
        if not os.path.isfile(full):
            return self._send(404, {"error": "not a file", "path": path})
        try:
            if os.path.getsize(full) > 10_000_000:
                return self._send(413, {"error": "file too large"})
            with open(full, "r", errors="replace") as f:
                return self._send(200, {"path": path, "content": f.read()})
        except OSError as e:
            return self._send(500, {"error": str(e)})

    def _write(self, path):
        full = _resolve(path)
        if full is None:
            return self._send(403, {"error": "path escapes root"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        if len(body) > 50_000_000:
            return self._send(413, {"error": "file too large"})
        parent = os.path.dirname(full)
        if parent and not os.path.isdir(parent):
            try:
                os.makedirs(parent, exist_ok=True)
            except OSError as e:
                return self._send(500, {"error": str(e)})
        tmp = full + ".lansync.tmp"
        try:
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, full)
        except OSError as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            return self._send(500, {"error": str(e)})
        return self._send(200, {"ok": True, "path": path, "bytes": len(body),
                                "mtime": os.path.getmtime(full)})

    def _make(self, path):
        full = _resolve(path)
        if full is None:
            return self._send(403, {"error": "path escapes root"})
        if os.path.exists(full):
            return self._send(409, {"error": "already exists", "path": path})
        parent = os.path.dirname(full)
        if parent and not os.path.isdir(parent):
            try:
                os.makedirs(parent, exist_ok=True)
            except OSError as e:
                return self._send(500, {"error": str(e)})
        try:
            with open(full, "wb"):
                pass
        except OSError as e:
            return self._send(500, {"error": str(e)})
        return self._send(200, {"ok": True, "created": path})

    def _mkdir(self, path):
        full = _resolve(path)
        if full is None:
            return self._send(403, {"error": "path escapes root"})
        try:
            os.makedirs(full, exist_ok=True)
        except OSError as e:
            return self._send(500, {"error": str(e)})
        return self._send(200, {"ok": True, "mkdir": path})

    def _delete(self, path):
        full = _resolve(path)
        if full is None:
            return self._send(403, {"error": "path escapes root"})
        if not os.path.isfile(full):
            return self._send(400, {"error": "only files can be deleted", "path": path})
        try:
            os.remove(full)
        except OSError as e:
            return self._send(500, {"error": str(e)})
        return self._send(200, {"ok": True, "deleted": path})


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=int(os.environ.get("EON_LAN_PORT", "8788")))
    ap.add_argument("--bind", default=os.environ.get("EON_LAN_BIND", "0.0.0.0"))
    ap.add_argument("--root", default=ROOT)
    a = ap.parse_args()
    os.environ["EON_LAN_ROOT"] = os.path.abspath(a.root)
    globals()["ROOT"] = os.environ["EON_LAN_ROOT"]
    print("[lansync] serving %s on %s:%s (token-gated writes)" % (ROOT, a.bind, a.port), flush=True)
    ThreadingHTTPServer(("0.0.0.0", a.port) if a.bind == "0.0.0.0" else (a.bind, a.port),
                        Handler).serve_forever()


if __name__ == "__main__":
    main()
