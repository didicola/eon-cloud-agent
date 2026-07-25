import requests, time, subprocess, sys, os

TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
API_URL = f"https://api.telegram.org/bot{TOKEN}"
CHAT_ID = 6663994526

print("Starting blind-proxy on GitHub VM...")
subprocess.Popen(['node', 'blind-proxy.js'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(5)

print("Checking Telegram for messages...")
try:
    res = requests.get(f"{API_URL}/getUpdates", params={"offset": -1, "limit": 1}, timeout=15).json()
    if not res.get("result"):
        print("No new messages.")
        sys.exit(0)
        
    msg = res["result"][0].get("message", {})
    if str(msg.get("chat", {}).get("id")) != CHAT_ID or not msg.get("text"):
        sys.exit(0)
        
    text = msg["text"]
    print(f"Received: {text}")
    
    reply = "Error: No response from brain."
    # 1. Try local blind-proxy (523 models)
    try:
        llm_res = requests.post("http://127.0.0.1:8090/v1/chat/completions", json={
            "model": "auto",
            "messages": [{"role": "user", "content": text}],
            "max_tokens": 1000
        }, timeout=60)
        if llm_res.ok:
            reply = llm_res.json()["choices"][0]["message"]["content"]
    except Exception:
        # 2. Fallback to Pollinations if blind-proxy fails
        print("Blind-proxy failed, falling back to Pollinations...")
        llm_res = requests.post("https://text.pollinations.ai/openai/v1/chat/completions", json={
            "model": "openai",
            "messages": [{"role": "user", "content": text}],
            "max_tokens": 1000
        }, timeout=60)
        if llm_res.ok:
            reply = llm_res.json()["choices"][0]["message"]["content"]
            
    if "</think>" in reply:
        reply = reply.split("</think>")[1].strip()
        
    requests.post(f"{API_URL}/sendMessage", json={"chat_id": CHAT_ID, "text": reply, "parse_mode": "Markdown"}, timeout=15)
except Exception as e:
    print(f"Error: {e}")
