"""Cloud-Torch thin client — thin client only.

GOLDEN RULE: this file NEVER imports torch or
tensorflow. All ML compute is offloaded to ephemeral cloud GPU providers.
The local machine only uses stdlib: urllib.request + json.
"""
import argparse
import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.request

GATEWAY = os.environ.get("EON_ML_GATEWAY", "http://127.0.0.1:8787")
POLL_S = 3
TIMEOUT_S = 900


def _post(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


class CloudTensor:
    def run(
        self,
        code,
        data=None,
        framework="torch",
        gpu=False,
        provider="auto",
        poll_s=None,
        timeout_s=None,
    ):
        payload = {
            "code": code,
            "data": data if data is not None else {},
            "framework": framework,
            "gpu": gpu,
            "provider": provider,
        }
        t0 = time.time()
        resp = _post(f"{GATEWAY}/api/ml/run", payload)
        task_id = resp.get("task_id") or resp.get("id")
        if not task_id:
            return {
                "task_id": None,
                "status": "error",
                "result": resp,
                "provider": provider,
                "elapsed_s": round(time.time() - t0, 3),
            }
        poll_s = POLL_S if poll_s is None else poll_s
        timeout_s = TIMEOUT_S if timeout_s is None else timeout_s
        status = "queued"
        result = None
        prov = provider
        while time.time() - t0 < timeout_s:
            st = _get(f"{GATEWAY}/api/ml/status/{task_id}")
            status = st.get("status", "unknown")
            result = st.get("result")
            prov = st.get("provider", provider)
            if status in ("done", "failed"):
                break
            time.sleep(poll_s)
        return {
            "task_id": task_id,
            "status": status,
            "result": result,
            "provider": prov,
            "elapsed_s": round(time.time() - t0, 3),
        }

    def list_active(self):
        return _get(f"{GATEWAY}/api/ml/tasks")


def _self_test():
    try:
        torch_imported = ("torch" in sys.modules) or (
            importlib.util.find_spec("torch") is not None
        )
    except Exception:
        torch_imported = False
    try:
        tf_imported = ("tensorflow" in sys.modules) or (
            importlib.util.find_spec("tensorflow") is not None
        )
    except Exception:
        tf_imported = False
    print("cloud_torch thin client OK")
    print(
        json.dumps(
            {
                "torch_imported": torch_imported,
                "tensorflow_imported": tf_imported,
                "gateway": GATEWAY,
            }
        )
    )


def _main(argv=None):
    p = argparse.ArgumentParser(prog="cloud_torch")
    p.add_argument("--code")
    p.add_argument("--data", default="{}")
    p.add_argument("--framework", default="torch")
    p.add_argument("--gpu", action="store_true")
    p.add_argument("--provider", default="auto")
    p.add_argument("--poll", type=float)
    p.add_argument("--timeout", type=float)
    p.add_argument("--list", action="store_true")
    p.add_argument("--test", action="store_true")
    a = p.parse_args(argv)
    if a.test:
        _self_test()
        return 0
    if a.list:
        print(json.dumps(CloudTensor().list_active()))
        return 0
    if not a.code:
        p.error("--code required (or --test / --list)")
    data = json.loads(a.data)
    out = CloudTensor().run(
        a.code,
        data=data,
        framework=a.framework,
        gpu=a.gpu,
        provider=a.provider,
        poll_s=a.poll,
        timeout_s=a.timeout,
    )
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
