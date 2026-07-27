#!/usr/bin/env python3
"""
🜂 EON AUTO-FAILOVER — Autonomous Service Recovery
Monitors all services, restarts dead ones, takes over if primary machine dies.
"""
import urllib.request, json, os, sys, time, subprocess, sqlite3

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
CHECK_INTERVAL = 30  # seconds
MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
DB_PATH = os.path.expanduser("~/.eon/failover.db")

SERVICES = {
    "tor": {
        "check": "pgrep -x tor",
        "start": "service tor start",
        "critical": True
    },
    "blind-proxy": {
        "check": "pgrep -f 'node blind-proxy.js'",
        "start": "cd /root/blind-proxy && node blind-proxy.js > /root/blind-proxy.log 2>&1 &",
        "critical": True
    },
    "render-eon": {
        "check": "pgrep -f render_eon.py",
        "start": "python3 /root/render_eon.py &",
        "critical": False
    },
    "cloud-terminal": {
        "check": "curl -s --max-time 3 http://127.0.0.1:8090/v1/models | grep -q object",
        "start": "cd /root/blind-proxy && node blind-proxy.js > /root/blind-proxy.log 2>&1 &",
        "critical": True
    }
}

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("""CREATE TABLE IF NOT EXISTS service_state (
        service TEXT PRIMARY KEY,
        status TEXT,
        last_check REAL,
        last_restart REAL,
        restart_count INTEGER DEFAULT 0,
        consecutive_failures INTEGER DEFAULT 0
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS failover_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL,
        event TEXT,
        details TEXT
    )""")
    db.commit()
    return db

def check_service(name, config):
    """Check if a service is running"""
    try:
        result = subprocess.run(
            config["check"], shell=True, capture_output=True, timeout=10
        )
        return result.returncode == 0
    except:
        return False

def start_service(name, config):
    """Start a service"""
    try:
        subprocess.run(config["start"], shell=True, timeout=30)
        return True
    except:
        return False

def send_alert(message):
    """Send Telegram alert"""
    data = json.dumps({"chat_id": CHAT_ID, "text": f"🔧 EON FAILOVER: {message}"}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except:
        pass

def run_failover_daemon():
    """Main failover loop"""
    db = init_db()
    print(f"🔧 EON AUTO-FAILOVER — {MACHINE_ID} — interval: {CHECK_INTERVAL}s")
    
    while True:
        try:
            for name, config in SERVICES.items():
                running = check_service(name, config)
                now = time.time()
                
                row = db.execute("SELECT * FROM service_state WHERE service=?", (name,)).fetchone()
                
                if running:
                    if row and row[5] > 0:  # was failing
                        send_alert(f"{name} recovered (was failing {row[5]}x)")
                    db.execute("""INSERT OR REPLACE INTO service_state 
                        (service, status, last_check, last_restart, restart_count, consecutive_failures)
                        VALUES (?, 'running', ?, ?, ?, 0)""",
                        (name, now, row[3] if row else now, row[4] if row else 0))
                    print(f"  ✅ {name}: running")
                else:
                    failures = (row[5] if row else 0) + 1
                    print(f"  ❌ {name}: down (failure #{failures})")
                    
                    if failures <= 3:
                        # Try to restart
                        print(f"  🔄 Restarting {name}...")
                        if start_service(name, config):
                            db.execute("""INSERT OR REPLACE INTO service_state 
                                (service, status, last_check, last_restart, restart_count, consecutive_failures)
                                VALUES (?, 'restarting', ?, ?, ?, ?)""",
                                (name, now, now, (row[4] if row else 0) + 1, failures))
                            send_alert(f"{name} restarted (attempt #{failures})")
                        else:
                            db.execute("""INSERT OR REPLACE INTO service_state 
                                (service, status, last_check, last_restart, restart_count, consecutive_failures)
                                VALUES (?, 'failed', ?, ?, ?, ?)""",
                                (name, now, row[3] if row else now, row[4] if row else 0, failures))
                    elif failures == 3 and config["critical"]:
                        # Critical service dead after 3 attempts
                        send_alert(f"🚨 CRITICAL: {name} is dead after {failures} restart attempts!")
                        db.execute("INSERT INTO failover_log (timestamp, event, details) VALUES (?, ?, ?)",
                            (now, "critical_failure", f"{name} dead after {failures} attempts"))
                    
                    db.execute("INSERT OR REPLACE INTO service_state VALUES (?, ?, ?, ?, ?, ?)",
                        (name, "failed" if failures > 3 else "restarting", now, 
                         row[3] if row else now, row[4] if row else 0, failures))
                
                db.commit()
            
            time.sleep(CHECK_INTERVAL)
            
        except KeyboardInterrupt:
            print("\nFailover daemon stopped")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        db = init_db()
        rows = db.execute("SELECT * FROM service_state").fetchall()
        for row in rows:
            status = "✅" if row[1] == "running" else "❌"
            print(f"  {status} {row[0]}: {row[1]} (failures: {row[5]})")
    else:
        run_failover_daemon()
