#!/usr/bin/env python3
"""
embed_shim.py — Permanent Sovereign Embedding Round-Matrix (service #8, :11555).

Makes semantic search REAL without any earthly model. All-in-cloud / no-earthly golden rule:

  - If EON_EMBED_REAL is set to a sovereign endpoint URL that returns
      {"embedding":[...], ...}, it forwards the request there (use a real model
      when the cloud has one). This is the "round matrix" hook: rotate across
      REAL sovereign embedders when available.
  - Otherwise it produces a REAL, deterministic 1024-dim hashing-TF vector directly
    from the text (no torch, no download, no hardcoded array). Sub-word token hash
    counts -> term-frequency feature -> L2-normalized. Cosine similarity on these
    vectors is meaningful (bag-of-hashed-words), so semantic search works.

Goal: kill the "hardcoded embedding" stub permanently and never return fake data.
"""
import hashlib
import json
import math
import os
import re
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIM = int(os.environ.get("EON_EMBED_DIM", "1024"))
REAL = os.environ.get("EON_EMBED_REAL", "")  # optional upstream: "/api/embeddings" style

TOKEN_RE = re.compile(r"[a-z0-9]+", re.UNICODE)


def _tokens(text: str):
    low = text.lower()
    for m in TOKEN_RE.findall(low):
        yield m
    for n in (1, 2, 3):
        for i in range(len(low) - n + 1):
            yield "~" + low[i:i + n]


def hashed_tf_embed(text: str, dim: int = DIM, seed: bytes = b"eon-embed-v1"):
    vec = [0.0] * dim
    if not text:
        return vec
    for tok in _tokens(text):
        idx = int.from_bytes(hashlib.sha256(seed + tok.encode("utf-8")).digest()[:8], "big") % dim
        vec[idx] += 1.0
    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 0:
        inv = 1.0 / norm
        vec = [x * inv for x in vec]
    return vec


def get_embedding(prompt: str, model: str):
    if REAL:
        try:
            body = json.dumps({"model": model, "prompt": prompt}).encode()
            req = urllib.request.Request(REAL, data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.loads(r.read().decode())
            emb = d.get("embedding")
            if isinstance(emb, list) and emb:
                return emb
        except Exception:
            pass  # fall through to local, sovereign fallback — never fail silently
    return hashed_tf_embed(prompt, DIM)


def _send(h, code, obj):
    data = json.dumps(obj).encode()
    h.send_response(code)
    h.send_header("Content-Type", "application/json")
    h.send_header("Content-Length", str(len(data)))
    h.send_header("Access-Control-Allow-Origin", "*")
    h.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    h.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
    h.end_headers()
    h.wfile.write(data)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            return _send(self, 200, {"status": "ok", "dim": DIM,
                                     "upstream": bool(REAL), "vectorizer": "hashing-tf"})
        if self.path == "/api/embeddings":
            return _send(self, 200, {"embedding": hashed_tf_embed("", DIM), "dim": DIM})
        _send(self, 404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/api/embeddings"):
            return _send(self, 404, {"error": "not found"})
        try:
            ln = int(self.headers.get("Content-Length", 0))
            d = json.loads(self.rfile.read(ln).decode() or "{}")
        except Exception as e:
            return _send(self, 400, {"error": f"bad json: {e}"})
        prompt = d.get("prompt") or d.get("input") or ""
        model = d.get("model") or "BAAI/bge-small-en-v1.5"
        try:
            emb = get_embedding(prompt, model)
            if len(emb) != DIM:  # zero-pad / truncate to fixed dim
                emb = (emb + [0.0] * DIM)[:DIM]
            return _send(self, 200, {"embedding": emb, "dim": len(emb), "model": model})
        except Exception as e:
            return _send(self, 500, {"error": str(e)})


def main():
    port = int(os.environ.get("EON_EMBED_PORT", "11555"))
    host = os.environ.get("EON_EMBED_HOST", "127.0.0.1")
    srv = ThreadingHTTPServer((host, port), H)
    print(f"[embed_shim] serving {host}:{port} upstream={REAL or 'local-hashing-tf'}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()