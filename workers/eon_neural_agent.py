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
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json",
                                          "X-Node-Id": NODE_ID,
                                          "User-Agent": f"eon-agent/{NODE_ID}"})
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
    """Route AI inference through Matrix (:8200) — the sovereign model brain."""
    payload = {"prompt": prompt, "model": model or "auto"}
    try:
        req = urllib.request.Request(MATRIX + "/v1/chat/completions", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


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
        # in a real deployment this calls a local embedding model
        result = {"embedding": [round(len(text) / 1000.0, 4), 0.5, 0.9], "node": NODE_ID}
        return result
    if t == "infer":
        return infer(payload.get("prompt", ""), payload.get("model"))
    if t == "train-report":
        return {"status": "reported", "node": NODE_ID}
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
        if cycle % 5 == 0:
            tasks = claim_tasks()
            for task in tasks.get("tasks", []):
                print(f"[eon-agent] executing {task['type']} {task['id']}")
                result = execute(task)
                call("POST", "/api/compute/complete", {"task_id": task["id"], "result": result})
            print(f"[eon-agent] cycle {cycle}: hb={hb.get('status')}, tasks={len(tasks.get('tasks', []))}")
        try:
            time.sleep(INTERVAL)
        except KeyboardInterrupt:
            break
    print("[eon-agent] stopped")


if __name__ == "__main__":
    main()
