#!/usr/bin/env python3
"""
🜂 EON MASTER DAEMON — Runs all parallel world services
Starts heartbeat, failover, memory sync, and monitor as a single process.
"""
import os, sys, time, threading, signal

MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
os.environ["EON_MACHINE_ID"] = MACHINE_ID

def run_daemon(name, func, interval=None):
    """Run a daemon in a thread"""
    def wrapper():
        try:
            print(f"🚀 Starting {name}...")
            if interval:
                func(interval)
            else:
                func()
        except Exception as e:
            print(f"❌ {name} crashed: {e}")
    
    t = threading.Thread(target=wrapper, daemon=True, name=name)
    t.start()
    return t

def main():
    print(f"🜂 EON MASTER DAEMON — {MACHINE_ID.upper()}")
    print("=" * 50)
    
    # Import daemons
    from eon_heartbeat import run_heartbeat_daemon, HEARTBEAT_INTERVAL
    from eon_failover import run_failover_daemon, CHECK_INTERVAL
    from eon_memory_sync import run_sync
    from eon_monitor import run_monitor_daemon
    
    # Start all daemons
    threads = []
    threads.append(run_daemon("heartbeat", run_heartbeat_daemon))
    threads.append(run_daemon("failover", run_failover_daemon))
    threads.append(run_daemon("memory-sync", run_sync))
    threads.append(run_daemon("monitor", run_monitor_daemon, 300))
    
    print("=" * 50)
    print(f"✅ All daemons started on {MACHINE_ID}")
    print("Press Ctrl+C to stop all daemons")
    
    # Keep alive
    try:
        while True:
            time.sleep(60)
            alive = sum(1 for t in threads if t.is_alive())
            print(f"💓 {alive}/{len(threads)} daemons alive")
    except KeyboardInterrupt:
        print("\n🛑 Shutting down all daemons...")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        MACHINE_ID = sys.argv[1]
        os.environ["EON_MACHINE_ID"] = MACHINE_ID
    main()
