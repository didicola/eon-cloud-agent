#!/usr/bin/env python3
"""
imaginary_time_queue.py — Imaginary Time Queue (Blank Time).

Tasks born in "blank time" (imaginary time) are not yet real. They evolve under
a complex-number state mapping until their wavefunction becomes non-singular:

    real component      a = retry count (real_attempts)
    imaginary component b = number of distinct failed paths

    state z = a + b*i ; non-singular iff a >= 2 and |z| = sqrt(a^2 + b^2) > 1.0

When a task is non-singular it tunnels to the real time queue (status='real')
ready for execution. Backed by sqlite3 at state/eon_physics.db (stdlib only).

Usage:
    python3 imaginary_time_queue.py --push --id t1 --payload '{"x":1}'
    python3 imaginary_time_queue.py --process
    python3 imaginary_time_queue.py --drain
"""
import json
import os
import sqlite3
import sys
import threading
import time

DB = "/root/eon-cloud-agent/state/eon_physics.db"
_SCHEMA = """
CREATE TABLE IF NOT EXISTS imaginary_time (
    id TEXT PRIMARY KEY,
    payload TEXT,
    real_attempts INT,
    imaginary_imag TEXT,
    status TEXT,
    created REAL,
    retried REAL
)"""


def _conn():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    c = sqlite3.connect(DB)
    c.execute(_SCHEMA)
    return c


def push(task_id, payload):
    """Insert/upsert a task into imaginary (blank) time."""
    c = _conn()
    now = time.time()
    c.execute(
        """INSERT INTO imaginary_time (id, payload, real_attempts, imaginary_imag, status, created, retried)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, status='imaginary'""",
        (task_id, json.dumps(payload), 0, "[]", "imaginary", now, None))
    c.commit()
    c.close()


def _solve(row):
    """One blank-time evolution tick. Returns updated fields or None."""
    tid, _, attempts, imag = row[0], row[1], row[2], row[3]
    attempts = int(attempts or 0)
    try:
        failed = json.loads(imag or "[]")
    except Exception:
        failed = []
    if not isinstance(failed, list):
        failed = []
    a = attempts + 1
    b = len(failed) + 1
    failed.append("fail_path_%d_%d" % (a, b))
    mag = abs(complex(a, b))
    status, retried = "imaginary", None
    if a >= 2 and mag > 1.0:
        status, retried = "real", time.time()
    return a, json.dumps(failed), status, retried


def _evolve_loop(duration_s):
    deadline = time.time() + max(0.0, duration_s)
    while True:
        c = _conn()
        rows = c.execute(
            "SELECT id, payload, real_attempts, imaginary_imag FROM imaginary_time WHERE status='imaginary'"
        ).fetchall()
        for row in rows:
            a, imag_json, status, retried = _solve(row)
            c.execute(
                "UPDATE imaginary_time SET real_attempts=?, imaginary_imag=?, status=?, retried=? WHERE id=?",
                (a, imag_json, status, retried, row[0]))
        c.commit()
        c.close()
        if time.time() >= deadline:
            break
        time.sleep(1.0)


def background_loop(duration_s=60):
    """Run the imaginary-time evolution in a background thread."""
    t = threading.Thread(target=_evolve_loop, args=(duration_s,), daemon=True)
    t.start()
    return t


def drain_real():
    """Return tasks that have tunneled to the real time queue."""
    c = _conn()
    rows = c.execute(
        "SELECT id, payload, real_attempts, imaginary_imag, status, created, retried FROM imaginary_time WHERE status='real'"
    ).fetchall()
    c.close()
    cols = ["id", "payload", "real_attempts", "imaginary_imag", "status", "created", "retried"]
    out = []
    for r in rows:
        d = dict(zip(cols, r))
        try:
            d["payload"] = json.loads(d["payload"])
        except Exception:
            pass
        out.append(d)
    return out


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)

    def argval(flag, default=None):
        return args[args.index(flag) + 1] if flag in args else default

    if "--push" in args:
        tid = argval("--id", "t1")
        payload = json.loads(argval("--payload", "{}"))
        push(tid, payload)
        print(json.dumps({"pushed": tid, "status": "imaginary"}))
        return 0

    if "--process" in args:
        t = background_loop(duration_s=3)
        t.join()
        print(json.dumps({"drained": drain_real()}, indent=2))
        return 0

    if "--drain" in args:
        print(json.dumps({"drained": drain_real()}, indent=2))
        return 0

    print(__doc__.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
