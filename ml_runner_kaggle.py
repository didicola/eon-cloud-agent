"""cloud runner — torch allowed only inside this file.

Kaggle T4 kernel: pulls a job, executes its code on the Kaggle GPU,
uploads weights to the sovereign mirror, and reports back to the gateway.
Runs in the CLOUD (Kaggle), NOT on the local machine.
"""
import io
import json
import os
import shutil
import contextlib
import urllib.request

GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://127.0.0.1:8787")
MIRROR_HOST = os.environ.get("MIRROR_HOST", "127.0.0.1")
ML_FRAMEWORK = os.environ.get("ML_FRAMEWORK", "torch").lower()


def _fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read().decode("utf-8")


def _load_job():
    if os.environ.get("KAGGLE_JOB_URL"):
        return json.loads(_fetch(os.environ["KAGGLE_JOB_URL"]))
    local = "/kaggle/input/job.json"
    if os.path.isfile(local):
        with open(local) as f:
            return json.load(f)
    raise RuntimeError("no job: set KAGGLE_JOB_URL or provide /kaggle/input/job.json")


def _load_framework(framework):
    if framework == "tf":
        import tensorflow as tf

        return tf.__version__
    import torch

    return torch.__version__


def main():
    job = _load_job()
    task_id = job.get("task_id")
    code = job.get("code", "")
    data = job.get("data", {})
    framework = str(job.get("framework", ML_FRAMEWORK)).lower()
    version = str(job.get("version", "latest"))

    fw = _load_framework(framework)
    print(f"framework {framework} ready: {fw}", flush=True)

    buf = io.StringIO()
    ok = True
    error = None
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(code, "<kaggle-job>", "exec"), {"data": data, "task_id": task_id})
    except Exception as e:
        ok = False
        error = repr(e)
    result = {"stdout": buf.getvalue(), "error": error, "framework": framework}

    working = "/kaggle/working"
    out_dir = os.path.join(working, version)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "result.json"), "w") as f:
        json.dump(result, f, indent=2)
    for name in job.get("files", []):
        src = os.path.join(working, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(out_dir, name))

    if shutil.which("rclone"):
        rc = os.system(
            f"rclone copy {out_dir} sovereign:models/{version} 2>/dev/null || "
            f"rclone copy {out_dir} mirror:models/{version} 2>/dev/null"
        )
        print(f"rclone upload rc={rc}", flush=True)

    payload = {
        "task_id": task_id,
        "status": "done" if ok else "failed",
        "result": result,
        "provider": "kaggle",
    }
    req = urllib.request.Request(
        f"{GATEWAY_URL}/api/ml/complete",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        print("webhook:", r.read().decode("utf-8"), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
