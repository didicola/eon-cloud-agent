#!/usr/bin/env python3
"""
🜂 EON MATRIX ROUTER — Intelligent Multi-Channel Communication
Uses Telegram + GitHub + Cloud Brain as redundant channels.
Each message gets a tracking ID. Receiver ACKs. Auto-retry on failure.
"""
import urllib.request, json, os, sys, time, hashlib, sqlite3, threading

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
CLOUD_URL = "https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions"
CLOUD_TOKEN = os.environ.get("EON_CLOUD_BRAIN_TOKEN", "")
GITHUB_REPO = "didicola/eon-cloud-agent"

MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
DB_PATH = os.path.expanduser(f"~/.eon/matrix_{MACHINE_ID}.db")

# Message prefixes
CMD_PREFIX = "!CMD"
RESP_PREFIX = "!RESP"
ACK_PREFIX = "!ACK"
SYNC_PREFIX = "!SYNC"
HEARTBEAT_PREFIX = "!HB"

CHANNELS = ["telegram", "github", "cloud"]

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("""CREATE TABLE IF NOT EXISTS messages (
        msg_id TEXT PRIMARY KEY,
        sender TEXT,
        receiver TEXT,
        channel TEXT,
        prefix TEXT,
        content TEXT,
        timestamp REAL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        ack_received INTEGER DEFAULT 0
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS channel_health (
        channel TEXT PRIMARY KEY,
        last_success REAL,
        last_failure REAL,
        failures INTEGER DEFAULT 0,
        avg_latency REAL DEFAULT 0
    )""")
    db.commit()
    return db

def gen_msg_id():
    """Generate unique message ID"""
    ts = str(time.time()).encode()
    return hashlib.md5(ts).hexdigest()[:12]

def send_telegram(text):
    """Send via Telegram"""
    data = json.dumps({"chat_id": CHAT_ID, "text": text[:4000]}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    start = time.time()
    with urllib.request.urlopen(req, timeout=15) as r:
        latency = time.time() - start
        return json.loads(r.read())["ok"], latency

def send_cloud(text):
    """Send via Cloud Brain as storage relay"""
    payload = json.dumps({
        "model": "auto",
        "messages": [{"role": "user", "content": f"RELAY_STORE|{MACHINE_ID}|{text[:2000]}"}],
        "max_tokens": 50
    }).encode()
    req = urllib.request.Request(CLOUD_URL, data=payload, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {CLOUD_TOKEN}",
        "User-Agent": "EonMatrixRouter/1.0"
    }, method="POST")
    start = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        latency = time.time() - start
        return json.loads(r.read())["choices"][0]["message"]["content"] is not None, latency

def get_telegram_updates(offset=0):
    """Poll Telegram for messages"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates?offset={offset}&limit=10&timeout=3"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

class MatrixRouter:
    def __init__(self):
        self.db = init_db()
        self.best_channel = "telegram"
        
    def update_channel_health(self, channel, success, latency=0):
        """Track channel health"""
        now = time.time()
        if success:
            self.db.execute("""INSERT OR REPLACE INTO channel_health 
                (channel, last_success, failures, avg_latency) 
                VALUES (?, ?, 0, ?)""",
                (channel, now, latency))
        else:
            self.db.execute("""UPDATE channel_health SET 
                last_failure=?, failures=failures+1 WHERE channel=?""",
                (now, channel))
        self.db.commit()
        self._select_best_channel()
    
    def _select_best_channel(self):
        """Intelligent channel selection based on health"""
        rows = self.db.execute("SELECT channel, last_success, failures, avg_latency FROM channel_health").fetchall()
        if not rows:
            self.best_channel = "telegram"
            return
        
        best_score = -999
        for ch, last_ok, failures, latency in rows:
            # Score: recent success = good, failures = bad, low latency = good
            score = 0
            if last_ok:
                age = time.time() - last_ok
                score += max(0, 100 - age)  # Fresh success = high score
            score -= failures * 10
            score -= latency * 5
            
            if score > best_score:
                best_score = score
                self.best_channel = ch
    
    def send(self, receiver, prefix, content, msg_id=None):
        """Send message via best channel, retry on failure"""
        if msg_id is None:
            msg_id = gen_msg_id()
        
        full_msg = f"{prefix}|{msg_id}|{MACHINE_ID}|{content}"
        
        db_msg = {
            "msg_id": msg_id,
            "sender": MACHINE_ID,
            "receiver": receiver,
            "channel": self.best_channel,
            "prefix": prefix,
            "content": content,
            "timestamp": time.time(),
            "status": "sending"
        }
        
        self.db.execute("""INSERT OR REPLACE INTO messages VALUES 
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (msg_id, MACHINE_ID, receiver, self.best_channel, prefix, content,
             time.time(), "sending", 0, 0))
        self.db.commit()
        
        # Try best channel first, then fallback
        channels_to_try = [self.best_channel] + [c for c in CHANNELS if c != self.best_channel]
        
        for channel in channels_to_try:
            try:
                if channel == "telegram":
                    ok, latency = send_telegram(full_msg)
                elif channel == "cloud":
                    ok, latency = send_cloud(full_msg)
                else:
                    continue
                
                if ok:
                    self.update_channel_health(channel, True, latency)
                    self.db.execute("""UPDATE messages SET status='sent', channel=?, attempts=attempts+1 
                        WHERE msg_id=?""", (channel, msg_id))
                    self.db.commit()
                    print(f"  ✅ [{channel}] {prefix} sent ({msg_id})")
                    return True
                    
            except Exception as e:
                self.update_channel_health(channel, False)
                print(f"  ❌ [{channel}] failed: {e}")
        
        self.db.execute("UPDATE messages SET status='failed' WHERE msg_id=?", (msg_id,))
        self.db.commit()
        return False
    
    def check_ack(self, msg_id, timeout=60):
        """Wait for ACK from receiver"""
        start = time.time()
        while time.time() - start < timeout:
            row = self.db.execute("SELECT ack_received FROM messages WHERE msg_id=?", (msg_id,)).fetchone()
            if row and row[0]:
                return True
            time.sleep(1)
        return False
    
    def process_incoming(self, text):
        """Parse and handle incoming message"""
        if not text.startswith(("!",)):
            return None
        
        parts = text.split("|", 3)
        if len(parts) < 4:
            return None
        
        prefix, msg_id, sender, content = parts
        
        if prefix == ACK_PREFIX:
            # ACK received
            self.db.execute("UPDATE messages SET ack_received=1, status='ackd' WHERE msg_id=?", (msg_id,))
            self.db.commit()
            return {"type": "ack", "msg_id": msg_id, "sender": sender}
        
        if prefix == CMD_PREFIX:
            # Command received - execute and respond
            return {"type": "cmd", "msg_id": msg_id, "sender": sender, "content": content}
        
        if prefix == RESP_PREFIX:
            # Response received
            return {"type": "resp", "msg_id": msg_id, "sender": sender, "content": content}
        
        if prefix == HEARTBEAT_PREFIX:
            # Heartbeat
            return {"type": "heartbeat", "msg_id": msg_id, "sender": sender, "content": content}
        
        return None
    
    def send_ack(self, msg_id, receiver):
        """Send ACK for received message"""
        self.send(receiver, ACK_PREFIX, "ok", msg_id)
    
    def send_command(self, receiver, cmd):
        """Send command and wait for response"""
        msg_id = self.send(receiver, CMD_PREFIX, cmd)
        if msg_id:
            print(f"  ⏳ Waiting for response...")
            return msg_id
        return None
    
    def get_pending_commands(self):
        """Get unprocessed commands"""
        return self.db.execute(
            "SELECT msg_id, sender, content FROM messages WHERE prefix=? AND status='sent' AND receiver=?",
            (CMD_PREFIX, MACHINE_ID)
        ).fetchall()
    
    def get_stats(self):
        """Get routing statistics"""
        stats = {}
        for ch in CHANNELS:
            row = self.db.execute("SELECT last_success, failures, avg_latency FROM channel_health WHERE channel=?", (ch,)).fetchone()
            if row:
                stats[ch] = {
                    "last_ok": row[0],
                    "failures": row[1],
                    "latency": row[2]
                }
            else:
                stats[ch] = {"last_ok": 0, "failures": 0, "latency": 0}
        
        total = self.db.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        acked = self.db.execute("SELECT COUNT(*) FROM messages WHERE ack_received=1").fetchone()[0]
        
        return {"channels": stats, "total": total, "acked": acked, "best": self.best_channel}

# Singleton
router = MatrixRouter()
