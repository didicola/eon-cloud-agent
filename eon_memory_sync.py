#!/usr/bin/env python3
"""
🜂 EON MEMORY SYNC — Bidirectional SQLite Sync via Cloud Brain
Uses Cloud Brain Worker as the sync intermediary.
Each machine pushes its memory to the cloud, pulls the other's changes.
"""
import urllib.request, json, os, sys, time, sqlite3, hashlib

CLOUD_URL = "https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions"
AUTH_TOKEN = os.environ.get("EON_CLOUD_BRAIN_TOKEN", "")
BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"

MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
MEMORY_DB = os.path.expanduser("~/.eon/eon_memory.db")
SYNC_STATE = os.path.expanduser("~/.eon/sync_state.json")

def init_memory_db():
    db = sqlite3.connect(MEMORY_DB)
    db.execute("CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, content TEXT, timestamp REAL, source TEXT, hash TEXT UNIQUE)")
    db.execute("CREATE TABLE IF NOT EXISTS knowledge (id INTEGER PRIMARY KEY, content TEXT, category TEXT, timestamp REAL, source TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp REAL, direction TEXT, count INTEGER, status TEXT)")
    db.commit()
    return db

def get_sync_state():
    if os.path.exists(SYNC_STATE):
        with open(SYNC_STATE) as f:
            return json.load(f)
    return {"last_push": 0, "last_pull": 0, "last_hash": ""}

def save_sync_state(state):
    with open(SYNC_STATE, "w") as f:
        json.dump(state, f, indent=2)

def export_memories(db):
    """Export all memories as JSON"""
    rows = db.execute("SELECT id, content, timestamp, source, hash FROM memories ORDER BY id").fetchall()
    return [{"id": r[0], "content": r[1], "timestamp": r[2], "source": r[3], "hash": r[4]} for r in rows]

def export_knowledge(db):
    """Export all knowledge as JSON"""
    rows = db.execute("SELECT id, content, category, timestamp, source FROM knowledge ORDER BY id").fetchall()
    return [{"id": r[0], "content": r[1], "category": r[2], "timestamp": r[3], "source": r[4]} for r in rows]

def cloud_request(prompt, max_tokens=2000):
    """Send data to Cloud Brain for storage"""
    payload = json.dumps({
        "model": "auto",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens
    }).encode()
    
    req = urllib.request.Request(CLOUD_URL, data=payload, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
        "User-Agent": "EonMemorySync/1.0"
    }, method="POST")
    
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]

def push_to_cloud(db):
    """Push local memories to cloud"""
    memories = export_memories(db)
    knowledge = export_knowledge(db)
    
    state = get_sync_state()
    
    # Create sync payload
    payload = {
        "machine": MACHINE_ID,
        "timestamp": time.time(),
        "memory_count": len(memories),
        "knowledge_count": len(knowledge),
        "memories": memories[-50:],  # Last 50 for bandwidth
        "knowledge": knowledge[-20:]  # Last 20 knowledge entries
    }
    
    payload_json = json.dumps(payload)
    payload_hash = hashlib.md5(payload_json.encode()).hexdigest()
    
    if payload_hash == state.get("last_hash"):
        print("  No changes to push")
        return True
    
    # Send via cloud brain
    prompt = f"STORE_SYNC_DATA|{MACHINE_ID}|{payload_json}"
    response = cloud_request(prompt)
    
    if "stored" in response.lower() or "ok" in response.lower():
        state["last_push"] = time.time()
        state["last_hash"] = payload_hash
        save_sync_state(state)
        
        db.execute("INSERT INTO sync_log (timestamp, direction, count, status) VALUES (?, 'push', ?, 'ok')",
            (time.time(), len(memories)))
        db.commit()
        
        print(f"  ✅ Pushed {len(memories)} memories, {len(knowledge)} knowledge")
        return True
    
    print(f"  ❌ Push failed: {response[:100]}")
    return False

def pull_from_cloud(db):
    """Pull remote memories from cloud"""
    state = get_sync_state()
    
    prompt = f"RETRIEVE_SYNC_DATA|{'ubuntu' if MACHINE_ID == 'termux' else 'termux'}|since:{state.get('last_pull', 0)}"
    response = cloud_request(prompt)
    
    try:
        # Try to extract JSON from response
        start = response.find('{')
        end = response.rfind('}') + 1
        if start >= 0 and end > start:
            data = json.loads(response[start:end])
            
            imported = 0
            for m in data.get("memories", []):
                try:
                    db.execute("INSERT OR IGNORE INTO memories (content, timestamp, source, hash) VALUES (?, ?, ?, ?)",
                        (m["content"], m.get("timestamp", time.time()), m.get("source", "remote"), m.get("hash", hashlib.md5(m["content"].encode()).hexdigest())))
                    imported += 1
                except:
                    pass
            
            for k in data.get("knowledge", []):
                try:
                    db.execute("INSERT OR IGNORE INTO knowledge (content, category, timestamp, source) VALUES (?, ?, ?, ?)",
                        (k["content"], k.get("category"), k.get("timestamp", time.time()), k.get("source", "remote")))
                except:
                    pass
            
            db.commit()
            
            state["last_pull"] = time.time()
            save_sync_state(state)
            
            db.execute("INSERT INTO sync_log (timestamp, direction, count, status) VALUES (?, 'pull', ?, 'ok')",
                (time.time(), imported))
            db.commit()
            
            print(f"  ✅ Pulled {imported} memories")
            return True
    except:
        pass
    
    print(f"  ⚠️ No data to pull or parse error")
    return False

def run_sync():
    """Full sync cycle"""
    db = init_memory_db()
    print(f"🔄 EON MEMORY SYNC — {MACHINE_ID}")
    
    while True:
        try:
            print(f"\n[{time.strftime('%H:%M:%S')}] Pushing to cloud...")
            push_to_cloud(db)
            
            print(f"[{time.strftime('%H:%M:%S')}] Pulling from cloud...")
            pull_from_cloud(db)
            
            print(f"[{time.strftime('%H:%M:%S')}] Sync complete. Sleeping 300s...")
            time.sleep(300)
            
        except KeyboardInterrupt:
            print("\nSync stopped")
            break
        except Exception as e:
            print(f"Sync error: {e}")
            time.sleep(60)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        db = init_memory_db()
        push_to_cloud(db)
        pull_from_cloud(db)
    else:
        run_sync()
