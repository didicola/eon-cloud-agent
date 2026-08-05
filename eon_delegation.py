# EON AGI Delegation System — routes tasks across all nodes and backends
# Uses: blind proxy (:8090), sovereign router (:3003), MEGA matrix, email union
import json, os, sys, time, threading, sqlite3, subprocess, urllib.request
from datetime import datetime

MACHINE = "ubuntu"
ARCHIVE = "/mnt/fluid-cloud/ai-archive"
QUEUE_DB = os.path.expanduser("~/.eon/delegation.db")
BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"

NODES = [
    {"name": "blind-proxy", "url": "http://127.0.0.1:8090/v1/chat/completions",
     "model": "auto", "weight": 2.0, "type": "ai"},
    {"name": "sovereign-router", "url": "http://127.0.0.1:3003/v1/chat/completions",
     "model": "gpt-4.1", "weight": 1.8, "type": "ai"},
    {"name": "hf-bridge", "model": "mistralai/Mistral-7B-Instruct-v0.3",
     "weight": 0.5, "type": "hf"},
    {"name": "mega-storage", "path": "/mnt/fluid-cloud",
     "weight": 2.0, "type": "storage"},
    {"name": "cloud-opencode", "url": "http://127.0.0.1:3090/v1/chat/completions",
     "model": "eon-matrix/auto", "weight": 1.5, "type": "ai"},
]

def init_db():
    db = sqlite3.connect(QUEUE_DB)
    db.execute("CREATE TABLE IF NOT EXISTS queue (id TEXT, task TEXT, node TEXT, time REAL, status TEXT, result TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS nodes (name TEXT PRIMARY KEY, alive REAL, last_seen REAL, tasks_done INT)")
    db.commit()
    return db

def telegram(msg):
    try:
        data = json.dumps({"chat_id": CHAT_ID, "text": msg}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except:
        pass

def call_ai(node, prompt):
    if node["type"] == "ai":
        payload = json.dumps({"model": node.get("model","auto"),
            "messages": [{"role":"user","content":prompt}],
            "max_tokens": 500}).encode()
        try:
            req = urllib.request.Request(node["url"], data=payload,
                headers={"Content-Type":"application/json"})
            resp = urllib.request.urlopen(req, timeout=60)
            d = json.loads(resp.read())
            return d["choices"][0]["message"]["content"], True
        except Exception as e:
            return str(e), False
    elif node["type"] == "hf":
        cmd = ["curl", "-sL", "--max-time", "30", "--socks5-hostname", "127.0.0.1:9050",
               "-X", "POST", f"https://api-inference.huggingface.co/models/{node['model']}",
               "-H", "Content-Type: application/json",
               "-d", json.dumps({"inputs": prompt})]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=35)
            if r.stdout:
                d = json.loads(r.stdout)
                if isinstance(d, list):
                    return d[0].get("generated_text", str(d[0])), True
            return r.stdout[:200], False
        except Exception as e:
            return str(e), False
    return "unknown node type", False

def broadcast(prompt):
    results = []
    for node in NODES:
        if node["type"] not in ("ai", "hf"):
            continue
        t0 = time.time()
        response, ok = call_ai(node, prompt)
        elapsed = time.time() - t0
        score = node["weight"] * (10 if ok else 0) * max(1, 10 - elapsed)
        results.append({"node": node["name"], "ok": ok,
            "response": response[:200] if ok else response,
            "score": round(score, 1), "elapsed": round(elapsed, 1)})
    results.sort(key=lambda x: -x["score"])
    return results

def save_result(prompt, response, node, score):
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    date = datetime.utcnow().strftime("%Y-%m-%d")
    os.makedirs(f"{ARCHIVE}/delegations", exist_ok=True)
    path = f"{ARCHIVE}/delegations/{date}.jsonl"
    entry = json.dumps({"ts": ts, "node": node, "score": score,
        "prompt": prompt[:200], "response": response[:500]})
    with open(path, "a") as f:
        f.write(entry + "\n")
    return path

def heartbeat():
    db = init_db()
    while True:
        for node in NODES:
            db.execute("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?)",
                (node["name"], 1.0, time.time(),
                 db.execute("SELECT tasks_done FROM nodes WHERE name=?",
                    (node["name"],)).fetchone()[0] if db.execute(
                    "SELECT tasks_done FROM nodes WHERE name=?",
                    (node["name"],)).fetchone() else 0))
        db.commit()
        time.sleep(60)

def delegate(prompt):
    print(f"Delegating: {prompt[:60]}...")
    results = broadcast(prompt)
    print(f"  Nodes responded: {sum(1 for r in results if r['ok'])}/{len(results)}")

    if not results or not results[0]["ok"]:
        print("  ❌ All nodes failed")
        telegram(f"DELEGATION FAILED: {prompt[:100]}")
        return None, None

    best = results[0]
    path = save_result(prompt, best["response"], best["node"], best["score"])
    print(f"  Best: {best['node']} (score={best['score']})")
    print(f"  Saved: {path}")
    telegram(f"DELEGATED to {best['node']} [{best['score']}]: {prompt[:60]}")

    db = init_db()
    db.execute("INSERT INTO queue (id,task,node,time,status,result) VALUES (?,?,?,?,?,?)",
        (f"del_{int(time.time())}", prompt[:200], best["node"],
         time.time(), "done", best["response"][:500]))
    db.commit()
    return best["node"], best["response"]

def main():
    print("EON AGI Delegation System")
    print(f"  Machine: {MACHINE}")
    print(f"  Nodes: {[n['name'] for n in NODES]}")
    print(f"  Archive: {ARCHIVE}/delegations\n")

    t = threading.Thread(target=heartbeat, daemon=True)
    t.start()
    telegram("EON AGI Delegation System started")

    while True:
        prompt = input("  Delegate > ").strip()
        if not prompt or prompt == "/quit":
            break
        if prompt == "/nodes":
            for n in NODES:
                print(f"  {n['name']} (weight={n['weight']}, type={n['type']})")
            continue
        if prompt == "/status":
            for n in NODES:
                alive = init_db().execute("SELECT alive FROM nodes WHERE name=?",
                    (n["name"],)).fetchone()
                print(f"  {n['name']}: {'✅ alive' if alive and alive[0] else '❌ unknown'}")
            continue
        node, response = delegate(prompt)
        if response:
            print(f"\n  [{node}]\n  {response[:500]}\n")

if __name__ == "__main__":
    main()
