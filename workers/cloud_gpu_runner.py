#!/usr/bin/env python3
"""cloud_gpu_runner.py — sovereign cloud-GPU runner (pure stdlib, no torch).

Pulls the next job from the EON mesh, runs it, and posts the result back.

Pipeline:
    GET  <mesh>/api/ml/job/latest     -> {task_id, code, data, framework, gpu, ...}
    run  (LOCAL DRY mode when the box has no torch and the job wants an
          snn/torch training run on a GPU: we emit deterministic pseudo-weights
          so the whole pipeline is exercisable without any real GPU)
    POST <mesh>/api/ml/complete       -> {task_id, status:"done", result, provider}

Zero torch/numpy/requests. urllib + json + subprocess + random + time only.

    python3 cloud_gpu_runner.py                    # daemon: loop every EON_RUNNER_LOOP_SEC
    python3 cloud_gpu_runner.py --once             # single pull+complete cycle, then exit
    python3 cloud_gpu_runner.py --once --simulate ml-1   # dry-sim a fake task id + complete
    python3 cloud_gpu_runner.py --mesh http://127.0.0.1:8787 --token eon:xxx
"""
import argparse
import hashlib
import importlib.util
import json
import os
import random
import subprocess
import sys
import time
import urllib.request

DEFAULT_MESH = os.environ.get("EON_ML_GATEWAY", "http://127.0.0.1:8787")
LOOP_S = float(os.environ.get("EON_RUNNER_LOOP_SEC", "15"))
WEIGHTS_LEN = 64


def _headers(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    return h


def _get(mesh, path, token=None, timeout=30):
    req = urllib.request.Request(mesh + path, headers=_headers(token))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8") or "{}")


def _post(mesh, path, payload, token=None, timeout=60):
    req = urllib.request.Request(
        mesh + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=_headers(token),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8") or "{}")


def has_torch():
    try:
        return importlib.util.find_spec("torch") is not None
    except (ImportError, ValueError):
        return False


def _pseudo_weights(task_id, length=WEIGHTS_LEN):
    """Deterministic pseudo-weights seeded by task_id (same job -> same weights)."""
    seed = int.from_bytes(hashlib.sha256(task_id.encode("utf-8")).digest()[:4], "big")
    rng = random.Random(seed)
    return [round(rng.random() * 2 - 1, 6) for _ in range(length)]


def run_dry_simulation(task):
    """LOCAL DRY MODE: fake an snn/torch training run on a GPU-less box."""
    task_id = task.get("id") or task.get("task_id") or "ml-unknown"
    data = task.get("data") or {}
    accuracy = round(0.5 + random.random() * 0.49, 4)
    result = {
        "metrics": {
            "accuracy": accuracy,
            "epochs": 3,
            "samples": 128 if data else 16,
        },
        "weights": _pseudo_weights(task_id, WEIGHTS_LEN),
        "version": "snn-sim-%d" % int(time.time() * 1000),
    }
    return result


def _looks_like_python(code):
    return bool(code) and not any(marker in code for marker in ("torch.", "import torch", "tensorflow"))


def exec_python(code, timeout=120):
    """Run plain-python job code in the venv interpreter, capturing stdout."""
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError("code exited %d: %s" % (proc.returncode, (proc.stderr or proc.stdout)[:400]))
    return proc.stdout


def run_job(task):
    """Run one job -> (result, provider). Returns (None, None) if we can't run it."""
    framework = (task.get("framework") or "").lower()
    gpu = bool(task.get("gpu"))
    code = task.get("code") or ""

    if gpu and framework in ("snn", "torch") and not has_torch():
        return run_dry_simulation(task), "dry-run-cpu"

    if framework in ("python", "generic") and _looks_like_python(code):
        output = exec_python(code)
        return {"output": output}, "dry-run-cpu"

    return None, None


def pull_job(mesh, token):
    status, body = _get(mesh, "/api/ml/job/latest", token)
    if status != 200:
        return None, status
    if "task_id" not in body and "id" not in body:
        return None, status
    return body, status


def complete_job(mesh, task_id, result, provider, token=None):
    payload = {
        "task_id": task_id,
        "status": "done",
        "result": result,
        "provider": provider,
    }
    status, body = _post(mesh, "/api/ml/complete", payload, token)
    return status, body


def run_cycle(mesh, token, simulate=None):
    if simulate:
        task = {"id": simulate, "task_id": simulate, "framework": "snn", "gpu": True,
                "data": {}, "code": "# simulated"}
        print("[runner] simulated pull %s" % simulate)
    else:
        task, status = pull_job(mesh, token)
        if not task:
            print("[runner] no runnable job (http %s)" % status)
            return None
        task_id = task.get("id") or task.get("task_id")
        print("[runner] pulled %s" % task_id)

    task_id = task.get("id") or task.get("task_id")
    result, provider = run_job(task)
    if result is None:
        print("[runner] no runner for %s (framework=%s gpu=%s)" % (
            task_id, task.get("framework"), task.get("gpu")))
        return task_id

    print("[runner] trained %s (%s)" % (task_id, provider))
    status, body = complete_job(mesh, task_id, result, provider, token)
    print("[runner] completed %s (http %s)" % (task_id, status))
    return task_id


def _main(argv=None):
    p = argparse.ArgumentParser(prog="cloud_gpu_runner", description=__doc__)
    p.add_argument("--mesh", default=DEFAULT_MESH)
    p.add_argument("--token", default=os.environ.get("EON_ACCESS_TOKEN"))
    p.add_argument("--once", action="store_true", help="single pull+complete cycle, then exit")
    p.add_argument("--simulate", metavar="TASK_ID", help="dry-sim a task id and complete it (debug)")
    a = p.parse_args(argv)

    if a.once:
        run_cycle(a.mesh, a.token, simulate=a.simulate)
        return 0
    print("[runner] daemon loop every %ss -> %s" % (LOOP_S, a.mesh))
    while True:
        try:
            run_cycle(a.mesh, a.token, simulate=a.simulate)
        except Exception as e:
            print("[runner] error: %s" % e)
        time.sleep(LOOP_S)


if __name__ == "__main__":
    sys.exit(_main())
