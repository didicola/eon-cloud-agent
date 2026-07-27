#!/usr/bin/env python3
"""
🜂 EON HEARTBEAT PROTOCOL — Machine-to-Machine Liveness Detection
Uses Telegram as the communication channel between Termux and Ubuntu.
Detects failure within 30 seconds. Bandwidth: ~200 bytes per heartbeat.
"""
import urllib.request, json, os, sys, time, hashlib, sqlite3

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
HEARTBEAT_INTERVAL = 15  # seconds
FAILURE_THRESHOLD = 3    # missed heartbeats = dead (45 seconds)

MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
DB_PATH = os.path.expanduser("~/.eon/heartbeat.db")

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("""CREATE TABLE IF NOT EXISTS heartbeats (
        machine TEXT PRIMARY KEY,
        timestamp REAL,
        status TEXT,
        cpu_pct REAL,
        mem_pct REAL,
        disk_pct REAL,
        hash TEXT
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL,
        machine TEXT,
        message TEXT,
        acknowledged INTEGER DEFAULT 0
    )""")
    db.commit()
    return db

def get_system_stats():
    """Collect minimal system stats"""
    stats = {"cpu": 0.0, "mem": 0.0, "disk": 0.0}
    try:
        with open("/proc/stat") as f:
            line = f.readline()
            vals = [int(x) for x in line.split()[1:]]
            idle = vals[3]
            total = sum(vals)
            stats["cpu"] = round((1 - idle / max(total, 1)) * 100, 1)
    except:
        pass
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                parts = line.split()
                info[parts[0].rstrip(":")] = int(parts[1])
            total = info.get("MemTotal", 1)
            avail = info.get("MemAvailable", total)
            stats["mem"] = round((1 - avail / total) * 100, 1)
    except:
        pass
    try:
        st = os.statvfs("/")
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        stats["disk"] = round((1 - free / max(total, 1)) * 100, 1)
    except:
        pass
    return stats

def send_heartbeat(db):
    """Send heartbeat via Telegram"""
    stats = get_system_stats()
    ts = time.time()
    
    payload = {
        "machine": MACHINE_ID,
        "timestamp": ts,
        "status": "alive",
        "cpu": stats["cpu"],
        "mem": stats["mem"],
        "disk": stats["disk"],
        "hash": hashlib.md5(f"{MACHINE_ID}:{ts}".encode()).hexdigest()[:8]
    }
    
    msg = f"💓 HEARTBEAT|{json.dumps(payload)}"
    
    data = json.dumps({"chat_id": CHAT_ID, "text": msg}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())
            if result["ok"]:
                db.execute("INSERT OR REPLACE INTO heartbeats VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (MACHINE_ID, ts, "alive", stats["cpu"], stats["mem"], stats["disk"], payload["hash"]))
                db.commit()
                return True
    except Exception as e:
        print(f"Heartbeat send failed: {e}")
    return False

def check_peer(db):
    """Check if peer machine is alive"""
    peer = "ubuntu" if MACHINE_ID == "termux" else "termux"
    row = db.execute("SELECT timestamp, status FROM heartbeats WHERE machine=?", (peer,)).fetchone()
    
    if row is None:
        return None, "no data"
    
    age = time.time() - row[0]
    if age > HEARTBEAT_INTERVAL * FAILURE_THRESHOLD:
        return False, f"dead ({age:.0f}s ago)"
    return True, f"alive ({age:.0f}s ago)"

def run_heartbeat_daemon():
    """Main heartbeat loop"""
    db = init_db()
    print(f"💓 EON HEARTBEAT — {MACHINE_ID} — interval: {HEARTBEAT_INTERVAL}s")
    
    while True:
        try:
            send_heartbeat(db)
            alive, msg = check_peer(db)
            peer = "ubuntu" if MACHINE_ID == "termux" else "termux"
            
            if alive is False:
                alert = f"🚨 FAILover: {peer} is {msg}"
                print(alert)
                db.execute("INSERT INTO alerts (timestamp, machine, message) VALUES (?, ?, ?)",
                    (time.time(), peer, alert))
                db.commit()
                
                # Send Telegram alert
                data = json.dumps({"chat_id": CHAT_ID, "text": f"🚨 EON ALERT: {alert}"}).encode()
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
            elif alive is None:
                print(f"⏳ Waiting for {peer}...")
            else:
                print(f"✅ {peer}: {msg}")
            
            time.sleep(HEARTBEAT_INTERVAL)
            
        except KeyboardInterrupt:
            print("\nHeartbeat stopped")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(HEARTBEAT_INTERVAL)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        db = init_db()
        send_heartbeat(db)
        alive, msg = check_peer(db)
        print(f"Peer status: {msg}")
    else:
        run_heartbeat_daemon()
