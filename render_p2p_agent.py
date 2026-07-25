import os, threading, requests, time, json
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow")
CHAT_ID = 6663994526
CLOUD_P2P_URL = "https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev"
BRIDGE_URL = "https://eon-hybrid-bridge.exportdefaultasyncfetchrequestenvconsturl.workers.dev"
TG_API = f"https://api.telegram.org/bot{TOKEN}"
PEER_ID = f"render:oregon:{os.uname().nodename}"

PROVIDERS = [
    {"name": "pollinations", "url": "https://text.pollinations.ai/openai/v1/chat/completions",
     "model": "openai", "key": None},
    {"name": "openrouter-free", "url": "https://openrouter.ai/api/v1/chat/completions",
     "model": "meta-llama/llama-3.3-70b-instruct:free", "key": None},
    {"name": "groq", "url": "https://api.groq.com/openai/v1/chat/completions",
     "model": "llama-3.3-70b-versatile",
     "key": os.environ.get("GROQ_API_KEY")},
    {"name": "openrouter-raw", "url": "https://openrouter.ai/api/v1/chat/completions",
     "model": "qwen/qwen3-coder:free", "key": os.environ.get("OPENROUTER_API_KEY")},
]

def send_tg(text: str):
    try:
        requests.post(f"{TG_API}/sendMessage", json={"chat_id": CHAT_ID, "text": text, "parse_mode": "Markdown"}, timeout=15)
    except:
        pass

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Eon P2P Render Node - ALIVE")
    def log_message(self, *a):
        pass

def run_health_server():
    port = int(os.environ.get("PORT", 10000))
    HTTPServer(("0.0.0.0", port), HealthHandler).serve_forever()

def call_llm(prompt: str) -> str | None:
    for p in PROVIDERS:
        try:
            headers = {"Content-Type": "application/json"}
            if p["key"]:
                headers["Authorization"] = f"Bearer {p['key']}"
            res = requests.post(p["url"], json={
                "model": p["model"],
                "messages": [{"role": "system", "content": "You are Eon. Be concise."},
                             {"role": "user", "content": prompt}],
                "max_tokens": 500,
            }, headers=headers, timeout=30)
            if res.ok:
                data = res.json()
                reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if reply:
                    if "</think>" in reply:
                        reply = reply.split("</think>")[1].strip()
                    return reply
        except:
            continue
    return None

def bridge_announce():
    try:
        r = requests.post(f"{BRIDGE_URL}/relay", json={
            "type": "announce", "from": PEER_ID,
            "payload": {"model": "pollinations/openrouter/groq"}
        }, timeout=10)
        d = r.json()
        print(f"[{PEER_ID}] Bridge: {len(d.get('peers',[]))} peers live", flush=True)
    except Exception as e:
        print(f"[{PEER_ID}] Bridge announce: {e}", flush=True)

def p2p_poll():
    while True:
        try:
            resp = requests.post(f"{CLOUD_P2P_URL}/p2p/tasks", json={"peer": PEER_ID}, timeout=15)
            task = resp.json().get("task")
            if task:
                prompt = task.get("prompt", "")
                model = task.get("model", "auto")
                print(f"[{PEER_ID}] Task {task['id'][:8]} ({model})", flush=True)
                result = call_llm(prompt) or "Render: no provider"
                requests.post(f"{CLOUD_P2P_URL}/p2p/task/{task['id']}", json={"result": result}, timeout=10)
                requests.post(f"{BRIDGE_URL}/relay", json={
                    "type": "p2p_result", "from": PEER_ID, "id": task["id"],
                    "payload": {"result": result[:200]}
                }, timeout=5)
                print(f"[{PEER_ID}] Completed task {task['id'][:8]}", flush=True)
        except:
            pass
        time.sleep(3)

def tg_loop():
    offset = 0
    time.sleep(10)
    while True:
        try:
            res = requests.get(f"{TG_API}/getUpdates", params={"offset": offset, "timeout": 30}, timeout=35).json()
            for update in res.get("result", []):
                offset = update["update_id"] + 1
                msg = update.get("message", {})
                if msg.get("text") and not msg.get("from", {}).get("is_bot"):
                    text = msg["text"]
                    print(f"[TG] {text[:50]}", flush=True)
                    reply = call_llm(text) or "No provider"
                    send_tg(reply)
        except:
            time.sleep(5)

if __name__ == "__main__":
    print(f"EON RENDER P2P NODE v2.0 — Hybrid Mesh", flush=True)
    print(f"Peer: {PEER_ID}", flush=True)
    print(f"Bridge: {BRIDGE_URL}", flush=True)
    threading.Thread(target=run_health_server, daemon=True).start()
    threading.Thread(target=tg_loop, daemon=True).start()
    threading.Thread(target=p2p_poll, daemon=True).start()
    bridge_announce()
    while True:
        time.sleep(120)
        bridge_announce()
