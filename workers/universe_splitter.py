#!/usr/bin/env python3
"""
universe_splitter.py — Many-Worlds Dataset Splitter (sovereign, no earthly MEGA).
Reads the daily Sovereign Memory export and divides it into N parallel universe
shards (universe_0.jsonl .. universe_{N-1}.jsonl), stored in the OWN fluid-cloud
mirror at /mnt/fluid-cloud/universes/ so each ephemeral compute node can pull its
assignment. Emits a shard manifest JSON the Matrix Coordinator uses to dispatch.
"""
import argparse
import json
import os
import re
import sys
import time
from collections import Counter

MIRROR = os.environ.get("EON_MIRROR", "/mnt/fluid-cloud")
UNIVERSE_DIR = os.path.join(MIRROR, "universes")
KV_JSON = os.environ.get("EON_KV_JSON", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "kv.json"))


def load_memory():
    """Read the sovereign KV export and collect memory episodes + any text blobs."""
    records = []
    if os.path.exists(KV_JSON):
        try:
            with open(KV_JSON) as f:
                kv = json.load(f)
        except Exception:
            kv = {}
        # kv.json may be the full KV map or an outer wrapper ({data: {...}}).
        data = kv.get("data", kv) if isinstance(kv, dict) else {}
        for key, val in (data.items() if isinstance(data, dict) else []):
            if not isinstance(val, str):
                val = json.dumps(val)
            try:
                obj = json.loads(val)
            except Exception:
                obj = val
            text = ""
            if isinstance(obj, dict):
                text = obj.get("text") or obj.get("content") or obj.get("prompt") or json.dumps(obj)
            elif isinstance(obj, str):
                text = obj
            text = str(text).strip()
            if text:
                records.append({"key": key, "text": text})
    return records


def hashtf(text, dim=256):
    """Deterministic hashing-TF vector (same family as embed_shim) — a real, cosine-meaningful
    numeric representation of a shard of reality. No torch/GPU needed locally; merges fine."""
    vec = [0.0] * dim
    toks = re.findall(r"[a-z0-9]{2,}", text.lower())
    for t in toks:
        h = 0
        for ch in t:
            h = (h * 31 + ord(ch)) & 0xFFFFFFFF
        vec[h % dim] += 1.0
    norm = sum(x * x for x in vec) ** 0.5 or 1.0
    return [round(x / norm, 6) for x in vec]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3, help="number of universes")
    ap.add_argument("--dim", type=int, default=256, help="adapter vector dimension per universe")
    ap.add_argument("--out", default=UNIVERSE_DIR)
    args = ap.parse_args()

    records = load_memory()
    N = max(1, args.n)
    os.makedirs(args.out, exist_ok=True)
    ts = time.strftime("%Y%m%d%H%M%S", time.gmtime())

    shards = [[] for _ in range(N)]
    for i, rec in enumerate(records):
        shards[i % N].append(rec)

    manifest = {"ts": ts, "n": N, "dim": args.dim,
                "total_records": len(records), "universes": []}
    for i in range(N):
        shard_file = os.path.join(args.out, f"universe_{i}.jsonl")
        with open(shard_file, "w") as f:
            for rec in shards[i]:
                f.write(json.dumps(rec) + "\n")
        adapter = hashtf(" ".join(r["text"] for r in shards[i]), args.dim)
        manifest["universes"].append({
            "universe": i, "file": shard_file, "records": len(shards[i]),
            "adapter": adapter,
        })

    shard_csv = os.path.join(args.out, f"universe_manifest_{ts}.json")
    with open(shard_csv, "w") as f:
        json.dump(manifest, f)

    print(json.dumps({
        "status": "split", "ts": ts, "n": N, "dim": args.dim,
        "total_records": len(records), "dir": args.out, "manifest": shard_csv,
        "universes": [{"universe": u["universe"], "records": u["records"], "file": u["file"]}
                      for u in manifest["universes"]],
        # Collapsed-reality seed: graveyard-average of all universe adapters = many-worlds prior.
        "seed_collapsed": [
            round(sum(u["adapter"][j] for u in manifest["universes"]) / max(N, 1), 6)
            for j in range(args.dim)
        ],
    }))


if __name__ == "__main__":
    main()