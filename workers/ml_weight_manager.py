"""ML Weight Manager — pure stdlib. NEVER imports torch or
tensorflow. Publishes model weights to the sovereign mirror and tracks the
active version via the gateway KV or the mirror's version.latest fallback.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.request

MIRROR_ROOT = "/mnt/fluid-cloud/models"
GATEWAY = os.environ.get("EON_ML_GATEWAY", "http://127.0.0.1:8787")


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def publish_version(version, files_dir):
    dest = os.path.join(MIRROR_ROOT, version)
    os.makedirs(dest, exist_ok=True)
    files = []
    hash_map = {}
    for entry in sorted(os.listdir(files_dir)):
        src = os.path.join(files_dir, entry)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dest, entry))
            files.append(entry)
            hash_map[entry] = _sha256(src)
    manifest = {
        "version": version,
        "files": files,
        "published_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hash_map": hash_map,
    }
    with open(os.path.join(dest, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    with open(os.path.join(MIRROR_ROOT, "version.latest"), "w") as f:
        f.write(version)
    return manifest


def active_version():
    try:
        with urllib.request.urlopen(f"{GATEWAY}/api/ml/version", timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        return {"source": "gateway", **data}
    except Exception:
        pass
    try:
        with open(os.path.join(MIRROR_ROOT, "version.latest")) as f:
            v = f.read().strip()
        return {"source": "mirror", "version": v}
    except Exception as e:
        return {"source": "none", "error": str(e)}


def check_for_update(current_version):
    active = active_version()
    active_v = active.get("active_version") or active.get("version")
    return {
        "update": active_v is not None and active_v != current_version,
        "active": active_v,
        "current": current_version,
    }


def _main(argv=None):
    p = argparse.ArgumentParser(prog="ml_weight_manager")
    p.add_argument("--publish", metavar="VERSION")
    p.add_argument("--dir", metavar="FILES_DIR")
    p.add_argument("--check", metavar="CURRENT_VERSION")
    p.add_argument("--active", action="store_true")
    a = p.parse_args(argv)
    if a.publish:
        print(json.dumps(publish_version(a.publish, a.dir or ".")))
    elif a.check:
        print(json.dumps(check_for_update(a.check)))
    elif a.active:
        print(json.dumps(active_version()))
    else:
        p.error("use --publish <v> --dir <d>, --check <v>, or --active")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
