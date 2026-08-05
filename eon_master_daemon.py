# EON MASTER DAEMON — Runs all delegation, heartbeat, and AI systems
import os, sys, time, threading, signal, json, subprocess

MACHINE = "ubuntu"
PID_FILE = os.path.expanduser("~/.eon/master.pid")
LOG = os.path.expanduser("~/.eon/master.log")

def log(msg):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG, "a") as f:
        f.write(line + "\n")

def run_delegation():
    log("Starting Delegation System...")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from eon_delegation import delegate, NODES
    log(f"  Nodes: {[n['name'] for n in NODES]}")
    while True:
        time.sleep(30)

def run_heartbeat():
    log("Starting Heartbeat...")
    from eon_heartbeat import run_heartbeat_daemon
    run_heartbeat_daemon()

def run_failover():
    log("Starting Failover Monitor...")
    from eon_failover import run_failover_daemon
    run_failover_daemon()

def run_memory_sync():
    log("Starting Memory Sync (MEGA-backed)...")
    while True:
        try:
            archive = "/mnt/fluid-cloud/ai-archive"
            os.makedirs(f"{archive}/synced", exist_ok=True)
            for f in os.listdir(f"{archive}/"):
                if f.endswith(".jsonl"):
                    subprocess.run(["cp", f"{archive}/{f}", f"{archive}/synced/{f}"],
                        capture_output=True, timeout=10)
            log(f"  Sync: checked {archive}")
        except Exception as e:
            log(f"  Sync error: {e}")
        time.sleep(300)

def check_services():
    services = {
        "blind-proxy": ["pgrep", "-f", "blind-proxy.js"],
        "sovereign-router": ["pgrep", "-f", "eon_sovereign_router"],
        "fluid-gateway": ["pgrep", "-f", "rclone serve"],
        "autoscaler": ["systemctl", "--user", "is-active", "infinity-autoscaler.timer"],
    }
    for name, cmd in services.items():
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=5)
            alive = r.returncode == 0 or b"active" in r.stdout
            log(f"  {name}: {'✅ alive' if alive else '❌ dead'}")
        except:
            log(f"  {name}: ❌ unknown")

def main():
    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    log(f"🜂 EON MASTER DAEMON — {MACHINE}")
    log("=" * 50)

    # Check services
    log("Checking services...")
    check_services()

    # Start all daemons in threads
    daemons = [
        ("delegation", run_delegation),
        ("memory-sync", run_memory_sync),
        ("heartbeat", run_heartbeat),
    ]
    threads = []
    for name, func in daemons:
        t = threading.Thread(target=func, daemon=True, name=name)
        t.start()
        threads.append(t)
        log(f"  ✅ {name} started")

    # Test a delegation
    log("\nRunning initial delegation...")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from eon_delegation import broadcast, save_result
    results = broadcast("EON Master Daemon online. What is your first delegated task? 2 sentences.")
    if results and results[0]["ok"]:
        best = results[0]
        save_result("EON Master Daemon init", best["response"], best["node"], best["score"])
        log(f"  ✅ Best delegation: {best['node']} (score={best['score']})")
    else:
        log("  ❌ No delegation nodes responded")

    log("\n" + "=" * 50)
    log(f"All systems running. PID: {os.getpid()}")

    try:
        while True:
            time.sleep(60)
            alive = sum(1 for t in threads if t.is_alive())
            log(f"💓 Heartbeat: {alive}/{len(threads)} daemons alive")
    except KeyboardInterrupt:
        log("\nShutdown.")

if __name__ == "__main__":
    main()
