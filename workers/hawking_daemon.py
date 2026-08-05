#!/usr/bin/env python3
"""
hawking_daemon.py — Hawking Radiation Daemon.

Cloud mirror storage matrix at /mnt/fluid-cloud is scanned continuously. Files
whose mtime is older than HAWKING_TTL days are treated as "radiated" energy:
they are DELETED and their SHA-256 hash + metadata is fossilised into the
hawking_radiation table of state/eon_physics.db.

CRITICAL SAFETY (never evaporate these):
  - kv.latest.json
  - docs/ contents
  - brain/ contents
  - any path containing '.latest'
Only versioned kv.*.json snapshots and stray files older than the TTL go.

Usage:
    python3 hawking_daemon.py --once            # single scan
    python3 hawking_daemon.py                    # daemon loop (default)
Env: HAWKING_TTL (days, default 30), HAWKING_INTERVAL (s, default 3600),
     FLUID_ROOT (default /mnt/fluid-cloud).
"""
import hashlib
import json
import os
import sqlite3
import sys
import time

FLUID_ROOT = os.path.expandvars(
    os.environ.get("FLUID_ROOT", "/mnt/fluid-cloud"))
HAWKING_TTL = float(os.environ.get("HAWKING_TTL", "30"))
HAWKING_INTERVAL = float(os.environ.get("HAWKING_INTERVAL", "3600"))
DB = "/root/eon-cloud-agent/state/eon_physics.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS hawking_radiation (
    path TEXT PRIMARY KEY,
    name TEXT,
    size INT,
    mtime REAL,
    deleted_at REAL,
    hash TEXT
)"""


def _conn():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    c = sqlite3.connect(DB)
    c.execute(_SCHEMA)
    return c


def _protected(rel):
    """Always-keep entries: kv.latest.json, docs/, brain/, anything '.latest'."""
    parts = rel.replace(os.sep, "/").split("/")
    if any(".latest" in p for p in parts):
        return True
    if parts[0] in ("docs", "brain"):
        return True
    return False


def _evaporate(full, rel, now):
    try:
        with open(full, "rb") as f:
            data = f.read()
        digest = hashlib.sha256(data).hexdigest()
        st = os.stat(full)
        os.remove(full)
    except Exception as e:
        print("[hawking] ERROR evaporating %s: %s" % (rel, e))
        return
    c = _conn()
    c.execute(
        """INSERT OR REPLACE INTO hawking_radiation (path, name, size, mtime, deleted_at, hash)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (rel, os.path.basename(full), st.st_size, st.st_mtime, now, digest))
    c.commit()
    c.close()
    print("[hawking] EVAPORATED %s size=%d hash=%s..." % (rel, st.st_size, digest[:16]))


def scan_once():
    """One scan pass over the fluid-cloud mirror matrix."""
    deleted = kept = kept_always = 0
    if not os.path.isdir(FLUID_ROOT):
        print("[hawking] mirror root missing: %s" % FLUID_ROOT)
        return {"deleted": 0, "kept": 0, "kept_always": 0}
    now = time.time()
    for dirpath, _dirnames, filenames in os.walk(FLUID_ROOT):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            if not os.path.isfile(full):
                continue
            rel = os.path.relpath(full, FLUID_ROOT)
            if _protected(rel):
                kept_always += 1
                print("[hawking] KEEP-ALWAYS %s" % rel)
                continue
            age_days = (now - os.path.getmtime(full)) / 86400.0
            if age_days >= HAWKING_TTL:
                _evaporate(full, rel, now)
                deleted += 1
            else:
                kept += 1
                print("[hawking] keep %s (%.1fd < %dd)" % (rel, age_days, HAWKING_TTL))
    return {"deleted": deleted, "kept": kept, "kept_always": kept_always}


def main(argv=None):
    global HAWKING_TTL
    args = sys.argv[1:] if argv is None else list(argv)
    if "--ttl" in args:
        HAWKING_TTL = float(args[args.index("--ttl") + 1])
    if "--once" in args:
        print(json.dumps(scan_once()))
        return 0
    print("[hawking] daemon root=%s ttl=%dd interval=%ds" % (FLUID_ROOT, HAWKING_TTL, HAWKING_INTERVAL))
    while True:
        print(json.dumps(scan_once()))
        time.sleep(HAWKING_INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
