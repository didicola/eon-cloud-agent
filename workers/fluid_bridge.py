#!/usr/bin/env python3
"""
fluid_bridge.py — Sovereign Fluid Bridge (routing layer for the Matrix Processor).
  - Reasoning / logic prompts  -> LLM via the Ghost Round Matrix (:8200/:8090/models) over Tor.
  - Pattern / bio-sim prompts   -> trigger the SNN cloud trainer (GH-Actions) via worker dispatch.
  - Everything stays all-in-cloud: worker is the source of truth, this is a thin router.

Usage:  python3 fluid_bridge.py "<prompt>"
Also exposes a tiny HTTP POST service on :8401 for the worker /api/fluid route to call.
"""
import json
import os
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
# heuristics: biological/pattern keywords -> SNN branch; logic/math/reason -> LLM branch
PATTERN_WORDS = ("spike", "neuron", "sn n", "brain", "pattern", "bio", "visual",
                 "image", "simulate", "network activity", "burst", "membrane")
REASON_WORDS = ("reason", "logic", "math", "proof", "solve", "code", "explain",
                "compare", "why", "how does", "plan")


def _headers():
    h = {"Content-Type": "application/json"}
    token = os.environ.get("EON_ACCESS_TOKEN", "")
    if token:
        h["Authorization"] = "Bearer " + token
    return h


def _post(path, data, timeout=90):
    req = urllib.request.Request(MESH + path, data=json.dumps(data).encode(),
                                 headers=_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def _get(path, timeout=20):
    headers = {}
    token = os.environ.get("EON_ACCESS_TOKEN", "")
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urllib.request.urlopen(urllib.request.Request(MESH + path, headers=headers), timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def _recall_context(prompt):
    """Cortex recall: pull strongest (most emotionally-weighted) Hippocampus episodes and
    inject them as experiential context so routing 'remembers what worked before'."""
    try:
        eps = _get("/api/memory/recall?top=3")
        good = [e for e in (eps if isinstance(eps, list) else [])
                if isinstance(e, dict) and e.get("emotional_weight", 0) > 0]
        if not good:
            return ""
        tips = "; ".join(e["text"] for e in good[:3])
        return "[prior-experience] " + tips + "\n"
    except Exception:
        return ""


def _memorize(prompt, track, outcome, weight, tag):
    """Write an experience back to the Hippocampus (episodic + emotional weight)."""
    _post("/api/memory/episodic", {
        "text": f"prompt='{prompt[:160]}' -> {track} ({outcome}) weight {weight}",
        "tag": track, "emotional_weight": weight, "outcome": outcome,
    })


def route(prompt, _recall=True):
    prior = _recall_context(prompt) if _recall else ""
    low = prompt.lower()
    branch = "snn" if any(w in low for w in PATTERN_WORDS) else "llm"
    if branch == "snn":
        out = _snn_branch(prompt)
    else:
        out = _llm_branch(prior + prompt)
    return out


def _llm_branch(prompt):
    from eon_neural_agent import infer
    r = infer(prompt, "auto")
    content = ""
    try:
        content = r["choices"][0]["message"]["content"]
    except Exception:
        content = r.get("content") or r.get("error", "")
    return {"track": "llm", "prompt": prompt, "response": content,
            "endpoint": r.get("endpoint")}


def _snn_branch(prompt):
    # Dispatch the sovereign SNN trainer as a cloud compute task (all-in-cloud, no earthly GH).
    disp = _post("/api/compute/dispatch", {
        "type": "snn",
        "payload": {"prompt": prompt, "epochs": 2, "samples": 0},
    }, timeout=30)
    task_id = disp.get("task", {}).get("id") or disp.get("task_id") or f"bio-{int(time.time())}"
    node = disp.get("node") or "none-online"
    return {"track": "snn", "prompt": prompt, "task_id": task_id, "node": node,
            "note": "dispatched to sovereign cloud SNN trainer (workers/snn_trainer.py via /api/compute)"}


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        ln = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(ln)) if ln else {}
        prompt = body.get("prompt", "")
        out = route(prompt)
        track = out.get("track", "llm")
        ok = bool(out.get("response")) and not out.get("error")
        _memorize(prompt, track, "success" if ok else "failure", 1 if ok else -1, track)
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


def main():
    if len(sys.argv) > 1:
        print(json.dumps(route(" ".join(sys.argv[1:])), indent=2))
        return 0
    port = int(os.environ.get("EON_FLUID_PORT", "8401"))
    print(f"[fluid-bridge] Sovereign Fluid Bridge on :{port} (all-in-cloud routing)")
    HTTPServer(("127.0.0.1", port), H).serve_forever()


if __name__ == "__main__":
    raise SystemExit(main())