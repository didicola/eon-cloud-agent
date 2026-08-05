#!/usr/bin/env python3
"""
snapshot_daemon.py — Sovereign Geo-Redundancy mirror.
Every 60s:
  1. Copies the canonical KV (state/kv.json) to /mnt/fluid-cloud/ (fluid-cloud mirror),
     keeping the latest copy as kv.latest.json + a timestamped version (keep N).
  2. Replays the KV into the twin over Tor via /api/replica/apply (LWW) so node-twin
     has an up-to-date mirror of the canonical store (own-cloud geo-redundancy).
All-in-cloud: no earthly broker; mirror lives in our fluid-cloud and our twin.
"""
import json
import os
import shutil
import time
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

STATE = os.environ.get("EON_KV", "/root/eon-cloud-agent/state/kv.json")
MIRROR = os.environ.get("EON_MIRROR_DIR", "/mnt/fluid-cloud/")
INTERVAL = int(os.environ.get("EON_SNAPSHOT_INTERVAL", "60"))
KEEP = int(os.environ.get("EON_SNAPSHOT_KEEP", "10"))
SYNC_TWIN = os.environ.get("EON_SYNC_TWIN", "1") == "1"
MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
SELF_NODE = os.environ.get("EON_NODE_ID", "node5")


def _real_twin_online():
    """Return True only if a DISTINCT node (not the canonical self) has heartbeated recently.
    Guards against the box-syncing-itself loop that re-nests KV envelopes every 60s."""
    try:
        req = urllib.request.urlopen(MESH + "/api/nodes", timeout=8)
        nodes = json.loads(req.read().decode()).get("nodes", [])
    except Exception:
        return False
    now = int(time.time() * 1000)
    for n in nodes:
        nid = n.get("node_id")
        if nid and nid != SELF_NODE and (now - (n.get("last_seen") or 0)) < 180000:
            return True
    return False


def mirror_local():
    """Copy canonical KV to the fluid-cloud mirror (latest + timestamped version)."""
    os.makedirs(MIRROR, exist_ok=True)
    if not os.path.exists(STATE):
        return {"ok": False, "err": f"no {STATE}"}
    ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    versioned = os.path.join(MIRROR, f"kv.{ts}.json")
    shutil.copy2(STATE, versioned)
    shutil.copy2(STATE, os.path.join(MIRROR, "kv.latest.json"))
    # prune old versions, keep newest KEEP
    vers = sorted(f for f in os.listdir(MIRROR) if f.startswith("kv.") and f.endswith(".json"))
    for f in vers[:-KEEP]:
        os.remove(os.path.join(MIRROR, f))
    return {"ok": True, "version": ts, "kept": len(vers)}


def sync_twin():
    """Push the full KV to a REAL twin over Tor as LWW replica records.
    Only runs when a distinct node is online — otherwise it would dial the onion,
    resolve back to node5, and re-nest envelopes every 60s."""
    if not SYNC_TWIN:
        return {"ok": True, "skipped": "twin sync disabled"}
    if not _real_twin_online():
        return {"ok": True, "skipped": "no distinct twin online; self-replay avoided"}
    try:
        import twin_sync as tw
    except Exception as e:
        return {"ok": False, "err": f"twin_sync import: {e}"}
    try:
        with open(STATE) as f:
            d = json.load(f)
        now = int(time.time() * 1000)
        records = []
        for i, (k, raw) in enumerate(d.items()):
            # kv.json stores each entry as an envelope {v, meta, exp, ts}; extract the inner
            # value (mirroring what the worker's own snapshot endpoint returns) so the twin
            # applies clean single-layer JSON, not double-encoded envelopes.
            inner_v = raw
            if isinstance(raw, str):
                try:
                    env = json.loads(raw)
                    if isinstance(env, dict) and "v" in env:
                        inner_v = env["v"]
                except Exception:
                    pass
            if isinstance(inner_v, dict):
                inner_v = json.dumps(inner_v)
            records.append({"key": k.replace("sk:", "", 1), "value": inner_v,
                            "ts": now - (len(d) - i)})
        out = tw.apply_record(records)
        return {"ok": bool(out.get("status") == "applied" or "applied" in out),
                "applied": out.get("applied", out.get("raw", "?")), "records": len(records)}
    except Exception as e:
        return {"ok": False, "err": str(e)}


def main():
    print(f"[snapshot] geo-redundancy daemon every {INTERVAL}s -> {MIRROR} (twin={SYNC_TWIN})")
    while True:
        m = mirror_local()
        t = sync_twin()
        print(f"[snapshot] {time.strftime('%FT%TZ', time.gmtime())} "
              f"mirror={m} twin={ {k: v for k, v in t.items() if k != 'records'} }")
        try:
            time.sleep(INTERVAL)
        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()