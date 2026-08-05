#!/usr/bin/env python3
"""
benchmark_runner.py — Sovereign Bio-AI Benchmark Protocol (runs as a DISPATCHED CLOUD task).
  AI Track    : logic/reasoning tests -> free LLMs via the Ghost Round Matrix (:8200/:8090).
  SNN Track   : runs snn_trainer.py, records energy/accuracy/spike-sparsity.
  Human Track : reads results POSTed to the sovereign worker from the Onion digit-span test.
Results are merged and stored in the worker KV (all-in-cloud) via POST /api/benchmark/results.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")


def _post(path, data):
    req = urllib.request.Request(MESH + path, data=json.dumps(data).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def ai_track(samples):
    from eon_neural_agent import infer
    out = []
    for q in samples[:3]:
        r = infer(q, "auto")
        content = ""
        try:
            content = r["choices"][0]["message"]["content"]
        except Exception:
            content = r.get("content") or r.get("error", "")
        out.append({"prompt": q, "response": content, "endpoint": r.get("endpoint")})
    return out


def snn_track(epochs):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snn_trainer.py")
    r = subprocess.run([sys.executable, path, "--epochs", str(epochs),
                        "--out", "/tmp/snn_result.json"], capture_output=True, text=True, timeout=600)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return {"status": "failed", "stdout": r.stdout[-500:], "stderr": r.stderr[-500:]}


def human_track():
    # Human results already POSTed to the worker by the Onion page — pull them back.
    req = urllib.request.Request(MESH + "/api/benchmark/results")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            d = json.loads(resp.read().decode())
        return [x for x in d if x.get("track") == "human"]
    except Exception:
        return []


def domain_track():
    """12-Domain Human vs AI protocol (0.md Section 2-6) — runs the AI probes."""
    import domain_benchmark
    return domain_benchmark.run()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--samples", default=["Solve: 2+2*2?", "A car covers 100km in 2h, speed?"])
    args = ap.parse_args()
    result = {
        "ts": int(time.time() * 1000),
        "protocol": "12-domain-human-vs-ai-v1",
        "track": {
            "ai": ai_track(args.samples),
            "snn": snn_track(args.epochs),
            "human": human_track(),
            "domains": domain_track(),
        },
    }
    print(json.dumps(result, indent=2))
    up = _post("/api/benchmark/results", result)
    print("[benchmark] stored:", up)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())