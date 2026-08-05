#!/usr/bin/env python3
"""eon_gpu_node.py — real GPU-node registration for the sovereign EON mesh.

Fixes the phantom `gpu-node1`: registers this runner box as a real cloud-GPU
node so the trig round-matrix dispatch (/api/compute/dispatch) can route
gpu-heavy training types (snn/train/embed/dl/deep) to it, then heartbeats.

    POST /api/nodes                        {node_id, name, type, capabilities, services}
    POST /api/nodes/gpu-node1/heartbeat    {node_id}  (every 60s)

Pure stdlib urllib. Zero torch/numpy/requests.

    python3 eon_gpu_node.py                # register + heartbeat loop (60s)
    python3 eon_gpu_node.py --once         # register once, then exit
"""
import json
import os
import sys
import time
import urllib.request

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
NODE_ID = "gpu-node1"
HEARTBEAT_S = float(os.environ.get("EON_GPU_HEARTBEAT_SEC", "60"))


def _load_token():
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


def _headers():
    h = {"Content-Type": "application/json"}
    token = _load_token()
    if token:
        h["Authorization"] = "Bearer " + token
    return h


def _post(path, payload, timeout=15):
    req = urllib.request.Request(
        MESH + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=_headers(),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8") or "{}")


def register():
    payload = {
        "node_id": NODE_ID,
        "name": NODE_ID,
        "type": "cloud-gpu",
        "capabilities": ["compute", "gpu", "training"],
        "services": {"runner": "cloud_gpu_runner"},
    }
    return _post("/api/nodes", payload)


def heartbeat():
    return _post("/api/nodes/%s/heartbeat" % NODE_ID, {"node_id": NODE_ID})


def main(argv=None):
    one_shot = "--once" in (argv or sys.argv[1:])
    try:
        st, body = register()
        print("[gpu-node] registered %s http=%s %s" % (NODE_ID, st, json.dumps(body)[:200]))
    except Exception as e:
        print("[gpu-node] register error: %s" % e)
        return 1
    if one_shot:
        return 0
    while True:
        time.sleep(HEARTBEAT_S)
        try:
            st, body = heartbeat()
            print("[gpu-node] heartbeat %s http=%s" % (NODE_ID, st))
        except Exception as e:
            print("[gpu-node] heartbeat error: %s" % e)


if __name__ == "__main__":
    sys.exit(main())
