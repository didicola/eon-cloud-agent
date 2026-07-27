#!/usr/bin/env python3
"""
🜂 EON COMMAND RELAY — Cross-Machine Command Execution
Listens on Telegram for orders prefixed with [CMD], executes them, reports back.
This runs on the TARGET machine (Ubuntu) and listens for orders from Termux.
"""
import urllib.request, json, os, sys, time, subprocess, hashlib

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
MACHINE_ID = os.environ.get("EON_MACHINE_ID", "ubuntu")
CMD_PREFIX = "[CMD]"
RESP_PREFIX = "[RESP]"
POLL_INTERVAL = 5  # seconds
MAX_OUTPUT = 3000  # max chars in response

def send_response(text):
    """Send command output back via Telegram"""
    msg = f"{RESP_PREFIX} {MACHINE_ID}:\n{text[:MAX_OUTPUT]}"
    data = json.dumps({"chat_id": CHAT_ID, "text": msg}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=15)
    except:
        pass

def execute_command(cmd):
    """Execute a shell command and return output"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=120,
            cwd=os.path.expanduser("~")
        )
        output = result.stdout + result.stderr
        if not output.strip():
            output = "(no output)"
        return output
    except subprocess.TimeoutExpired:
        return "ERROR: Command timed out after 120s"
    except Exception as e:
        return f"ERROR: {e}"

def get_updates(offset):
    """Poll Telegram for new messages"""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates?offset={offset}&limit=5&timeout=3"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except:
        return {"ok": False, "result": []}

def run_listener():
    """Main listener loop"""
    print(f"🎧 EON COMMAND RELAY — {MACHINE_ID} — Listening for orders...")
    print(f"   Send commands from Termux: [CMD] your_command_here")
    print(f"   Poll interval: {POLL_INTERVAL}s")
    
    offset = 0
    
    while True:
        try:
            resp = get_updates(offset)
            
            if resp.get("ok"):
                for update in resp.get("result", []):
                    offset = update["update_id"] + 1
                    msg = update.get("message", {})
                    
                    if msg.get("chat", {}).get("id") != int(CHAT_ID):
                        continue
                    
                    text = msg.get("text", "")
                    
                    if text.startswith(CMD_PREFIX):
                        cmd = text[len(CMD_PREFIX):].strip()
                        print(f"\n📋 ORDER RECEIVED: {cmd}")
                        
                        # Execute
                        output = execute_command(cmd)
                        print(f"📤 Output: {output[:200]}")
                        
                        # Report back
                        send_response(output)
                        print(f"✅ Response sent to Telegram")
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print("\nListener stopped")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        # One-shot: execute a single command
        cmd = " ".join(sys.argv[2:])
        output = execute_command(cmd)
        print(output)
        send_response(output)
    else:
        run_listener()
