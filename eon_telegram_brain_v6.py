#!/usr/bin/env python3
"""
EON Telegram Brain v6 — Robust, self-contained.
No quantum matrix, no fragile imports. Every worker call wrapped.
Falls back across workers/models; never crashes on a message.
"""
import urllib.request, json, os, sys, time, ssl

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
POLL_TIMEOUT = 30
LAST_UPDATE = 0

WORKERS = [
    ("cloud-brain", "https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev", True),
    ("eon-p2p", "https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev", False),
]
CLOUD_BRAIN_TOKEN = "Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI"
MODELS = ["sovereign-cloud", "mistral-small", "qwen-coder", "llama-3.3-70b"]

def uname_machine():
    try:
        u = os.popen("uname -a").read().lower()
        return "termux" if "termux" in u or "android" in u else "ubuntu"
    except:
        return "ubuntu"

MACHINE = uname_machine()

def tg_api(method, data):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    try:
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"ok": False, "error": str(e)[:100]}

def send(text):
    tg_api("sendMessage", {"chat_id": CHAT_ID, "text": str(text)[:4000]})

def call_worker(name, url, auth, path, payload=None, timeout=30):
    try:
        full = url + path
        headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = f"Bearer {CLOUD_BRAIN_TOKEN}"
        body = json.dumps(payload).encode() if payload else None
        req = urllib.request.Request(full, data=body, headers=headers, method="POST" if payload else "GET")
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            raw = r.read().decode()
            try:
                return json.loads(raw)
            except:
                return {"raw": raw[:400], "status": "text"}
    except Exception as e:
        return {"error": str(e)[:150]}

def get_choice(r):
    if isinstance(r, dict):
        try:
            return r["choices"][0]["message"]["content"]
        except Exception:
            return None
    return None

def route_robust(prompt):
    attempts = []
    for worker, url, auth in WORKERS:
        for model in MODELS:
            if auth and model != "sovereign-cloud":
                continue
            r = call_worker(worker, url, auth, "/v1/chat/completions", {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 1500,
            })
            if "rebalancing" in str(r).lower() or "retry shortly" in str(r).lower():
                attempts.append(f"{worker}/{model}:rebalancing")
                time.sleep(1)
                continue
            content = get_choice(r)
            if content and len(content.strip()) > 5:
                return f"[{worker}/{model}] {content}"
            attempts.append(f"{worker}/{model}:{str(r.get('error',''))[:40]}")
    return "[error] All workers failed: " + "; ".join(attempts[-4:])

def handle_message(text):
    lower = text.strip().lower()
    if lower.startswith(("/start", "/help", "/version", "/status", "/models", "/dream")):
        cmd = lower.split()[0]
        if cmd == "/start" or cmd == "/help":
            return "EON Telegram Brain v6 — " + MACHINE.upper() + "\nJust send any message. Commands: /version /status /models"
        if cmd == "/version":
            return "EON Brain v6 | machine=" + MACHINE
        if cmd == "/status":
            lines = []
            for worker, url, auth in WORKERS:
                r = call_worker(worker, url, auth, "/health", timeout=8)
                ok = "error" not in r and "rebalancing" not in str(r).lower()
                lines.append(("✅" if ok else "❌") + " " + worker)
            return "Workers:\n" + "\n".join(lines)
        if cmd == "/models":
            return "Workers: cloud-brain, eon-p2p | Models: sovereign-cloud, mistral-small, qwen-coder, llama-3.3-70b"
        if cmd == "/dream":
            r = call_worker("eon-p2p", WORKERS[1][1], False, "/dream/list?limit=5", timeout=10)
            entries = r.get("entries", []) if isinstance(r, dict) else []
            if entries:
                return "Latest dreams:\n" + "\n".join("  - " + str(e.get("title", "?"))[:60] for e in entries)
            return "No dreams yet"
    tg_api("sendChatAction", {"chat_id": CHAT_ID, "action": "typing"})
    return route_robust(text)

def get_updates(offset, timeout=30):
    try:
        body = json.dumps({"offset": offset, "timeout": timeout}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates",
            data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout + 5) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"ok": False, "error": str(e)[:100], "result": []}

def poll_loop():
    global LAST_UPDATE
    print(f"EON Telegram Brain v6 — {MACHINE.upper()}", flush=True)
    print(f"Bot: @Ririmobot | Poll: {POLL_TIMEOUT}s", flush=True)
    print("=" * 50, flush=True)
    while True:
        try:
            data = get_updates(LAST_UPDATE + 1, POLL_TIMEOUT)
            for u in data.get("result", []):
                LAST_UPDATE = max(LAST_UPDATE, u.get("update_id", LAST_UPDATE))
                msg = u.get("message", {})
                chat_id = msg.get("chat", {}).get("id")
                text = msg.get("text", "")
                if chat_id == int(CHAT_ID) and text:
                    print(f"\nIN  {text[:80]}", flush=True)
                    try:
                        resp = handle_message(text)
                        send(resp)
                        print(f"OUT {str(resp)[:80]}", flush=True)
                    except Exception as e:
                        send("Brain error: " + str(e)[:200])
                        print(f"ERR {e}", flush=True)
        except KeyboardInterrupt:
            print("\nBot stopped", flush=True)
            break
        except Exception as e:
            print(f"poll: {e}", flush=True)
            time.sleep(5)

if __name__ == "__main__":
    del_ok = tg_api("deleteWebhook", {})
    print("Webhook deleted:", del_ok.get("ok", False), flush=True)
    poll_loop()
