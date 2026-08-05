#!/usr/bin/env python3
"""
learn_daemon.py — Multiverse Continuous-Learning Cron (service #12, sovereign, no earthly).
Acts as the Cloud Coordinator's own cron: every SOAK period it triggers a Many-Worlds
training run (/api/learn/spawn), watches universes finish, collapses the wavefunction
(/api/learn/collapse), and hot-swaps active_model_version. Pulls collapsed_reality into
the mirror so local inference engines can apply the upgraded brain.
"""
import json
import os
import signal
import time
import urllib.request

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
SOAK = int(os.environ.get("EON_LEARN_SOAK", os.environ.get("EON_LEARN_INTERVAL", "3600")))
COLLECT_WAIT = int(os.environ.get("EON_LEARN_COLLECT_WAIT", "150"))
UNIVERSES = int(os.environ.get("EON_LEARN_UNIVERSES", "3"))
DIM = int(os.environ.get("EON_LEARN_DIM", "256"))
MIRROR = os.environ.get("EON_MIRROR", "/mnt/fluid-cloud")
LOG = "/var/log/eon_learn.log"

running = True


def sig(s, f):
    global running
    running = False


signal.signal(signal.SIGTERM, sig)
signal.signal(signal.SIGINT, sig)


def log(msg):
    line = f"{time.strftime('%FT%TZ', time.gmtime())} {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def call(method, path, data=None, timeout=30):
    url = MESH + path
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "eon-learn/"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def get(path, timeout=15):
    try:
        with urllib.request.urlopen(MESH + path, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def mirror_collapsed(run_id, version):
    """Pull collapsed_reality from KV into our own fluid-cloud mirror (all-in-cloud)."""
    brain = get(f"/api/learn/hotswap")
    if not brain or not brain.get("brain"):
        return False
    br = brain["brain"]
    try:
        os.makedirs(f"{MIRROR}/brain", exist_ok=True)
        with open(f"{MIRROR}/brain/collapsed_reality_v{br['version']}.json", "w") as f:
            json.dump(br, f)
        with open(f"{MIRROR}/brain/active_model_version", "w") as f:
            f.write(str(br["version"]))
        # persistent sovereign marker for any inference daemon to apply
        with open(f"{MIRROR}/brain/current_reality", "w") as f:
            json.dump({"run_id": run_id, "version": br["version"],
                       "universes_survived": br.get("universes_survived"),
                       "collapsed_norm": round(sum(x * x for x in br["collapsed"]) ** 0.5, 4)}, f)
        return True
    except Exception as e:
        log(f"[mirror] failed: {e}")
        return False


def run_learning_cycle():
    log(f"== Many-Worlds learning cycle: {UNIVERSES} universes, dim={DIM} ==")
    sp = call("POST", "/api/learn/spawn", {"universes": UNIVERSES, "dim": DIM})
    if sp.get("error"):
        log(f"[spawn] FAILED: {sp.get('error')}")
        return {"cycle": "spawn_failed", "error": sp.get("error")}
    run_id = sp.get("run_id")
    log(f"[spawn] run={run_id} {sp.get('universes')} universes dispatched")
    # Collect window: wait for universes to finish (tolerant of crashes).
    deadline = time.time() + COLLECT_WAIT
    collected = {}
    reported = 0
    while time.time() < deadline:
        st = get(f"/api/learn/status?run_id={run_id}")
        if st.get("error"):
            time.sleep(5)
            continue
        reported = len(st.get("adapters", {}))
        if reported >= st.get("universes", UNIVERSES):
            break
        time.sleep(5)
    log(f"[collect] {reported}/{UNIVERSES} universes returned adapters")
    # Collapse the wavefunction (merger proceeds with survivors; crashed worlds omitted).
    cl = call("POST", "/api/learn/collapse", {"run_id": run_id})
    if cl.get("error"):
        # If zero universes returned, collapse on seed prior only.
        log(f"[collapse] BACKFILL (zero adapters?) -> collapse still called: {cl.get('error')}")
    version = cl.get("version")
    mirror_collapsed(run_id, version)
    summary = {
        "cycle": "complete", "run_id": run_id,
        "universes_total": sp.get("universes"),
        "universes_returned": reported,
        "collapsed_version": version,
        "survived": cl.get("brain", {}).get("universes_survived"),
        "failed": cl.get("brain", {}).get("failed"),
        "method": "parameter-average + seed-prior",
    }
    log(f"[collapse] version={version} survived={summary['survived']} failed={summary['failed']}")
    return summary


def main():
    log(f"learn_daemon up: mesh={MESH} soak={SOAK}s universes={UNIVERSES}")
    cycle = 0
    while running:
        cycle += 1
        try:
            summary = run_learning_cycle()
            # Episodic memory: store learning cycle outcome for recall/benchmark.
            call("POST", "/api/memory/episodic", {
                "text": f"Many-Worlds learning cycle {summary.get('run_id')}: "
                        f"{summary.get('universes_returned', 0)}/{summary.get('universes_total', 0)} "
                        f"universes collapsed to v{summary.get('collapsed_version')}",
                "tag": "learning", "emotional_weight": 0.7, "outcome": summary,
            })
        except Exception as e:
            log(f"[cycle] ERROR: {e}")
        try:
            for _ in range(SOAK):
                if not running:
                    return
                time.sleep(1)
        except KeyboardInterrupt:
            break
    log("learn_daemon stopped")


if __name__ == "__main__":
    main()