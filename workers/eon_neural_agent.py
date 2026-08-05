#!/usr/bin/env python3
"""
eon_neural_agent.py — EON Neural Web local compute agent
Registers this machine as a node, sends heartbeats, polls & executes compute tasks,
reports training progress, and routes AI inference through Matrix (:8200).
"""
import json
import os
import sys
import time
import signal
import urllib.request

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
NODE_ID = os.environ.get("EON_NODE_ID", "node5")
ONION = os.environ.get("EON_ONION", "o3izfmjjt2pmsgauio7fau3ykiwm5ion4ltojv7zegdpp7n74tfqsqad.onion")
MATRIX = os.environ.get("EON_MATRIX", "http://127.0.0.1:8200")
INTERVAL = int(os.environ.get("EON_AGENT_INTERVAL", "60"))
CAPABILITIES = os.environ.get("EON_CAPABILITIES", "compute,storage,dns,models,training").split(",")

running = True


def sig(s, f):
    global running
    running = False


signal.signal(signal.SIGTERM, sig)
signal.signal(signal.SIGINT, sig)


def call(method, path, data=None, timeout=15):
    url = MESH + path
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Content-Type": "application/json",
               "X-Node-Id": NODE_ID,
               "User-Agent": f"eon-agent/{NODE_ID}"}
    token = os.environ.get("EON_ACCESS_TOKEN", "")
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def load():
    try:
        with open("/proc/loadavg") as f:
            return float(f.read().split()[0])
    except Exception:
        return 0.0


def mem():
    try:
        with open("/proc/meminfo") as f:
            d = {}
            for line in f:
                k, _, v = line.partition(":")
                d[k] = int(v.strip().split()[0])
        return round(1 - d["MemAvailable"] / d["MemTotal"], 2)
    except Exception:
        return 0.0


def infer(prompt, model=None):
    """Route AI inference through the Sovereign matrix of backends via Ghost Round Matrix.
    Primary: Matrix (:8200). Mirror: blind-proxy (:8090). Queen: our models /api/models.
    Defeats '503 request queue is full' by rotating to the next sovereign endpoint."""
    from ghost_matrix import run_round
    payload = {"prompt": prompt, "model": model or "auto"}
    backends = [
        (os.environ.get("EON_MATRIX", "http://127.0.0.1:8200"), "/v1/chat/completions"),
        (os.environ.get("EON_BLINDPROXY", "http://127.0.0.1:8090"), "/v1/chat/completions"),
    ] + [
        (MESH + f"/api/models/{m}/infer", "/") for m in (os.environ.get("EON_MODELS", "") or "").split(",") if m
    ]

    def call_one(ep):
        base, suffix = ep
        try:
            url = base.rstrip("/") + suffix
            req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=150) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()
        except Exception as e:
            return 0, str(e)

    r = run_round(backends, call_one,
                  max_tries=int(os.environ.get("EON_GHOST_TRIES", "7")), base=0.3, cap=4.0)
    if r.get("ok"):
        try:
            return json.loads(r["body"])
        except Exception:
            return {"content": r["body"], "endpoint": r.get("endpoint")}
    return {"error": r.get("error", "ghost exhausted"), "endpoint": r.get("endpoint")}


def register():
    return call("POST", "/api/nodes", {
        "node_id": NODE_ID,
        "name": os.environ.get("EON_NODE_NAME", NODE_ID),
        "addr": ONION,
        "type": "termux-proot",
        "capabilities": CAPABILITIES,
        "services": {"mesh": 8787, "matrix": 8200, "ygg": 51820}
    })


def heartbeat():
    return call("POST", f"/api/nodes/{NODE_ID}/heartbeat", {"load": load(), "mem": mem()})


def claim_tasks():
    return call("POST", "/api/compute/claim", {"node_id": NODE_ID})


def execute(task):
    """Execute a compute task locally. Extend handlers for new task types."""
    t = task.get("type", "task")
    payload = task.get("payload", {})
    if t == "embed":
        text = payload.get("text", "")
        shim_url = os.environ.get("EON_EMBED_SHIM", "http://127.0.0.1:11555/api/embeddings")
        try:
            body = json.dumps({"model": "BAAI/bge-small-en-v1.5", "prompt": text}).encode()
            req = urllib.request.Request(shim_url, data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as r:
                if r.status != 200:
                    raise RuntimeError(f"embed shim HTTP {r.status}")
                resp = json.loads(r.read().decode())
            emb = resp.get("embedding")
            if not isinstance(emb, list) or not emb:
                raise RuntimeError("no embedding array in shim response")
            return {"embedding": emb, "dim": len(emb), "node": NODE_ID}
        except Exception as e:
            return {"status": "embed_degraded", "shim": "127.0.0.1:11555",
                    "error": str(e), "node": NODE_ID}
    if t == "infer":
        return infer(payload.get("prompt", ""), payload.get("model"))
    if t == "train-report":
        return {"status": "reported", "node": NODE_ID}
    if t == "train":
        # MANY-WORLDS TRAIN: this universe trains its own shard of reality into an adapter
        # weight vector. Sovereign: shard is read from our own fluid-cloud mirror (no earthly
        # MEGA). No torch/GPU? The hashing-TF adapter is a real, deterministic, cosine-meaningful
        # representation (same family as embed_shim) so the merger can average across worlds.
        # The day a GPU box joins, this branch runs real SNN/LoRA training instead.
        import re as _re
        dim = int(payload.get("dim", 256))
        shard = payload.get("shard", "")
        lines = []
        if shard and os.path.exists(shard):
            with open(shard) as f:
                lines = [json.loads(l)["text"] for l in f if l.strip()]
        text = payload.get("text", "") or " ".join(lines)
        vec = [0.0] * dim
        for tok in _re.findall(r"[a-z0-9]{2,}", (text or "").lower()):
            h = 0
            for ch in tok:
                h = (h * 31 + ord(ch)) & 0xFFFFFFFF
            vec[h % dim] += 1.0
        norm = sum(x * x for x in vec) ** 0.5 or 1.0
        weights = [round(x / norm, 6) for x in vec]
        # try real SNN training if requested + torch exists
        real = {"status": "degraded", "reason": "no torch/gpu on this node"}
        if payload.get("real") and not payload.get("real") == "0":
            try:
                import subprocess
                out = f"/tmp/snn_{NODE_ID}_{int(time.time())}.json"
                cp = subprocess.run(
                    [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "snn_trainer.py"),
                     "--epochs", str(int(payload.get("epochs", 2))), "--samples", str(len(lines)), "--out", out],
                    capture_output=True, text=True, timeout=900)
                try:
                    with open(out) as f:
                        real = json.load(f)
                    if real.get("weights"):
                        weights = real["weights"][:dim]
                        real = {"status": "trained", "epochs": real.get("epochs", 0), "loss": real.get("loss")}
                except Exception:
                    real = {"status": "degraded", "raw": (cp.stdout + cp.stderr)[-500:]}
            except Exception as e:
                real = {"status": "degraded", "error": str(e)}
        return {"status": "universe:trained", "node": NODE_ID, "universe": payload.get("universe"),
                "records": len(lines), "dim": dim, "weights": weights, "training": real}
    if t == "snn":
        # SQUENDER: execute the sovereign SNN trainer as a dispatched cloud task (no earthly GH).
        epochs = int(payload.get("epochs", 2))
        samples = int(payload.get("samples", 0))
        out = f"/tmp/snn_{NODE_ID}_{int(time.time())}.json"
        import subprocess
        cp = subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "snn_trainer.py"),
             "--epochs", str(epochs), "--samples", str(samples), "--out", out],
            capture_output=True, text=True, timeout=1500)
        result = None
        try:
            with open(out) as f:
                result = json.load(f)
        except Exception:
            result = {"status": "degraded", "raw": (cp.stdout + cp.stderr)[-800:]}
        result["node"] = NODE_ID
        result["dispatched"] = True
        return result
    return {"status": "unhandled_type", "type": t, "node": NODE_ID}


def report_training(job_id, step, loss, worker=NODE_ID):
    return call("POST", f"/api/training/jobs/{job_id}", {"worker": worker, "step": step, "loss": loss})


def main():
    print(f"[eon-agent] {NODE_ID} -> {MESH}")
    r = register()
    print(f"[eon-agent] register: {r.get('status', r)}")
    cycle = 0
    while running:
        cycle += 1
        hb = heartbeat()
        # SELF-REPAIR: if we are no longer a known node (host restarted / KV wiped),
        # re-register instead of silently orbiting with a dead identity.
        if not hb or hb.get("error") or hb.get("status") in ("unknown", "not_registered", 404):
            re = register()
            print(f"[eon-agent] SELF-REPAIR re-register: {re.get('status', re)}")
        if cycle % 5 == 0:
            tasks = claim_tasks()
            claimed = tasks.get("tasks", []) if isinstance(tasks, dict) else []
            ok = 0
            for task in claimed:
                if not isinstance(task, dict) or not task.get("id"):
                    print(f"[eon-agent] skipping malformed task: {repr(task)[:80]}")
                    continue
                print(f"[eon-agent] executing {task['type']} {task['id']}")
                result = execute(task)
                call("POST", "/api/compute/complete", {"task_id": task["id"], "result": result})
                ok += 1
                # MANY-WORLDS: feed a finished universe adapter straight back to the Cloud
                # Coordinator's /api/learn/complete so the merger can collapse the real ones.
                if task.get("type") == "train" and isinstance(result, dict) and result.get("universe") is not None:
                    rp = task.get("payload", {})
                    call("POST", "/api/learn/complete", {
                        "run_id": rp.get("run_id"), "universe": result.get("universe"),
                        "weights": result.get("weights"), "node": NODE_ID,
                    })
            print(f"[eon-agent] cycle {cycle}: hb={hb.get('status')}, tasks={len(claimed)}, done={ok}")
        try:
            time.sleep(INTERVAL)
        except KeyboardInterrupt:
            break
    print("[eon-agent] stopped")


if __name__ == "__main__":
    main()
