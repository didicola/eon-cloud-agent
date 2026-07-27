#!/usr/bin/env python3
"""
🜂 EON SERVICE MONITOR — Real-time Health Dashboard
Monitors all services and sends detailed status via Telegram.
"""
import urllib.request, json, os, sys, time, subprocess, sqlite3

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
MONITOR_DB = os.path.expanduser("~/.eon/monitor.db")

def init_db():
    db = sqlite3.connect(MONITOR_DB)
    db.execute("""CREATE TABLE IF NOT EXISTS health_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL,
        machine TEXT,
        service TEXT,
        status TEXT,
        response_time REAL,
        details TEXT
    )""")
    db.commit()
    return db

def check_url(name, url, timeout=5):
    """Check if a URL is responding"""
    start = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "EonMonitor/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            elapsed = (time.time() - start) * 1000
            return True, f"{r.status} OK ({elapsed:.0f}ms)"
    except Exception as e:
        elapsed = (time.time() - start) * 1000
        return False, f"{type(e).__name__} ({elapsed:.0f}ms)"

def check_process(name, pattern):
    """Check if a process is running"""
    try:
        result = subprocess.run(f"pgrep -f '{pattern}'", shell=True, capture_output=True, timeout=5)
        return result.returncode == 0, f"PID: {result.stdout.decode().strip()[:20]}"
    except:
        return False, "check failed"

def get_system_stats():
    """Get system resource stats"""
    stats = {}
    try:
        with open("/proc/loadavg") as f:
            stats["load"] = f.read().strip().split()[0]
    except:
        stats["load"] = "?"
    
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                parts = line.split()
                info[parts[0].rstrip(":")] = int(parts[1])
            total = info.get("MemTotal", 1)
            avail = info.get("MemAvailable", total)
            stats["mem_used"] = f"{(1 - avail/total)*100:.1f}%"
            stats["mem_total"] = f"{total//1024}MB"
    except:
        stats["mem_used"] = "?"
        stats["mem_total"] = "?"
    
    try:
        st = os.statvfs("/")
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        stats["disk_used"] = f"{(1 - free/max(total,1))*100:.1f}%"
        stats["disk_total"] = f"{total//(1024*1024*1024)}GB"
    except:
        stats["disk_used"] = "?"
        stats["disk_total"] = "?"
    
    return stats

def run_health_check():
    """Run full health check and send report"""
    db = init_db()
    now = time.time()
    
    checks = []
    
    # Local services
    local_checks = [
        ("blind-proxy", "http://127.0.0.1:8090/v1/models"),
        ("tor", None),
        ("render-eon", None),
    ]
    
    for name, url in local_checks:
        if url:
            ok, details = check_url(name, url)
        else:
            ok, details = check_process(name, "node blind-proxy" if "proxy" in name else name)
        
        status = "✅" if ok else "❌"
        checks.append((name, status, details))
        
        db.execute("INSERT INTO health_log (timestamp, machine, service, status, details) VALUES (?, ?, ?, ?, ?)",
            (now, MACHINE_ID, name, "ok" if ok else "fail", details))
    
    # Cloud services
    cloud_checks = [
        ("cloud-brain", "https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/models"),
        ("telegram-api", "https://api.telegram.org/bot8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow/getMe"),
        ("eon-p2p", "https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/"),
    ]
    
    for name, url in cloud_checks:
        ok, details = check_url(name, url)
        status = "✅" if ok else "❌"
        checks.append((name, status, details))
        
        db.execute("INSERT INTO health_log (timestamp, machine, service, status, details) VALUES (?, ?, ?, ?, ?)",
            (now, MACHINE_ID, name, "ok" if ok else "fail", details))
    
    db.commit()
    
    # System stats
    stats = get_system_stats()
    
    # Format report
    report = f"🜂 EON HEALTH REPORT — {MACHINE_ID.upper()}\n"
    report += f"Time: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
    report += f"Load: {stats['load']} | RAM: {stats['mem_used']} ({stats['mem_total']}) | Disk: {stats['disk_used']} ({stats['disk_total']})\n\n"
    
    for name, status, details in checks:
        report += f"  {status} {name}: {details}\n"
    
    # Count failures
    failures = sum(1 for _, s, _ in checks if s == "❌")
    report += f"\n{'🟢 ALL OK' if failures == 0 else f'🔴 {failures} FAILURES'}"
    
    # Send via Telegram
    data = json.dumps({"chat_id": CHAT_ID, "text": report}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            if json.loads(r.read())["ok"]:
                print(report)
                return True
    except Exception as e:
        print(f"Failed to send report: {e}")
    
    return False

def run_monitor_daemon(interval=300):
    """Run health checks periodically"""
    print(f"🜂 EON SERVICE MONITOR — {MACHINE_ID} — interval: {interval}s")
    while True:
        try:
            run_health_check()
            time.sleep(interval)
        except KeyboardInterrupt:
            print("\nMonitor stopped")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(60)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        run_health_check()
    else:
        run_monitor_daemon()
