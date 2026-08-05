# EON Matrix :8200 — unified OpenAI-compatible API for sovereign apps
import json, os, sys, time, urllib.request, urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

BLIND = "http://127.0.0.1:45579/v1/chat/completions"  # matrix-parallel (cloud via WARP, no blind-proxy)
SOVEREIGN = "http://127.0.0.1:3003/v1/chat/completions"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8200

class MatrixHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        if self.path == "/v1/models":
            models = {"object": "list", "data": [
                {"id": "auto", "object": "model", "created": int(time.time()), "owned_by": "blind-proxy"},
                {"id": "gpt-4.1", "object": "model", "created": int(time.time()), "owned_by": "sovereign"},
                {"id": "deepseek-chat", "object": "model", "created": int(time.time()), "owned_by": "sovereign"},
                {"id": "codestral", "object": "model", "created": int(time.time()), "owned_by": "sovereign"},
                {"id": "llama-3.3-70b", "object": "model", "created": int(time.time()), "owned_by": "sovereign"},
            ]}
            self._json(models)
        elif self.path == "/health":
            self._json({"status": "ok", "providers": ["blind-proxy:523", "sovereign:6"], "uptime": int(time.time() - start_time)})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except:
            self._json({"error": "invalid JSON"}, 400)
            return

        model = body.get("model", "auto")
        messages = body.get("messages", [])
        max_tokens = body.get("max_tokens", 500)

        # Route to appropriate provider with fallback
        if model in ("gpt-4.1", "deepseek-chat", "llama-3.3-70b", "codestral", "llama-4-scout"):
            # Try sovereign first, fallback to blind proxy
            url = SOVEREIGN
            actual_model = {"gpt-4.1": "gpt-4.1", "deepseek-chat": "deepseek-r1", "llama-3.3-70b": "llama-3.3-70b", "codestral": "codestral", "llama-4-scout": "llama-4-scout"}.get(model, "gpt-4.1")
        else:
            url = BLIND
            actual_model = model

        data = json.dumps({"model": actual_model, "messages": messages, "max_tokens": max_tokens}).encode()
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=120)
            result = json.loads(resp.read())
            self._json(result)
        except urllib.error.HTTPError as e:
            # Fallback to blind proxy if sovereign fails
            if url == SOVEREIGN:
                fallback_data = json.dumps({"model": "auto", "messages": messages, "max_tokens": max_tokens}).encode()
                try:
                    fb_req = urllib.request.Request(BLIND, data=fallback_data, headers={"Content-Type": "application/json"})
                    fb_resp = urllib.request.urlopen(fb_req, timeout=120)
                    self._json(json.loads(fb_resp.read()))
                    return
                except:
                    pass
            error_body = e.read().decode()[:500]
            self._json({"error": f"provider error: {e.code}", "detail": error_body, "note": "use model:auto for blind proxy fallback"}, 502)
        except Exception as e:
            self._json({"error": str(e)}, 500)

    def _json(self, data, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Matrix-Version", "1.0.0")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        sys.stderr.write(f"[Matrix] {format % args}\n")

start_time = time.time()
server = HTTPServer(("127.0.0.1", PORT), MatrixHandler)
print(f"🔥 Matrix :{PORT} — unified OpenAI API")
print(f"   Routes: blind-proxy (523 models) + sovereign (6 models)")
print(f"   Examples: /v1/models, /health, /v1/chat/completions")
server.serve_forever()
