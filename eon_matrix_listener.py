#!/usr/bin/env python3
"""
🜂 EON MATRIX LISTENER — Persistent listener using Matrix Router
Runs on BOTH machines. Polls Telegram, processes commands, sends responses.
"""
import urllib.request, json, os, sys, time, subprocess, hashlib

# Force load from same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eon_matrix_router import (
    router, BOT_TOKEN, CHAT_ID, MACHINE_ID,
    CMD_PREFIX, RESP_PREFIX, ACK_PREFIX, HEARTBEAT_PREFIX,
    init_db, gen_msg_id, get_telegram_updates, send_telegram
)

POLL_INTERVAL = 3  # seconds
HEARTBEAT_INTERVAL = 30  # seconds

def execute_command(cmd):
    """Execute shell command safely"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, 
            timeout=120, cwd=os.path.expanduser("~")
        )
        output = result.stdout + result.stderr
        return output.strip()[:2500] if output.strip() else "(no output)"
    except subprocess.TimeoutExpired:
        return "TIMEOUT after 120s"
    except Exception as e:
        return f"ERROR: {e}"

def send_heartbeat():
    """Send heartbeat with machine stats"""
    try:
        with open("/proc/loadavg") as f:
            load = f.read().split()[0]
    except:
        load = "?"
    
    hb_content = json.dumps({"machine": MACHINE_ID, "load": load, "ts": time.time()})
    router.send("all", HEARTBEAT_PREFIX, hb_content)

def run_listener():
    """Main listener loop"""
    print(f"🜂 EON MATRIX LISTENER — {MACHINE_ID.upper()}")
    print(f"   Channels: telegram | github | cloud")
    print(f"   Poll: {POLL_INTERVAL}s | Heartbeat: {HEARTBEAT_INTERVAL}s")
    print(f"   Router best channel: {router.best_channel}")
    print("=" * 50)
    
    offset = 0
    last_hb = 0
    db = init_db()
    
    while True:
        try:
            # Send periodic heartbeat
            if time.time() - last_hb > HEARTBEAT_INTERVAL:
                send_heartbeat()
                last_hb = time.time()
            
            # Poll Telegram
            resp = get_telegram_updates(offset)
            
            if resp.get("ok"):
                for update in resp.get("result", []):
                    offset = update["update_id"] + 1
                    msg = update.get("message", {})
                    
                    # Only process from our chat
                    if msg.get("chat", {}).get("id") != int(CHAT_ID):
                        continue
                    
                    text = msg.get("text", "")
                    sender_name = msg.get("from", {}).get("first_name", "unknown")
                    
                    if not text.startswith("!"):
                        continue
                    
                    # Parse message
                    parsed = router.process_incoming(text)
                    
                    if parsed is None:
                        continue
                    
                    if parsed["type"] == "ack":
                        print(f"  📨 ACK from {parsed['sender']} for {parsed['msg_id']}")
                        continue
                    
                    if parsed["type"] == "heartbeat":
                        print(f"  💓 Heartbeat from {parsed['sender']}")
                        continue
                    
                    if parsed["type"] == "cmd":
                        # Check if this command is for us
                        cmd = parsed["content"]
                        sender = parsed["sender"]
                        msg_id = parsed["msg_id"]
                        
                        # Don't process our own commands
                        if sender == MACHINE_ID:
                            continue
                        
                        print(f"\n📋 COMMAND from {sender}: {cmd[:80]}")
                        
                        # Execute
                        output = execute_command(cmd)
                        print(f"📤 Output: {output[:100]}")
                        
                        # Send ACK
                        router.send(sender, ACK_PREFIX, "executed", msg_id)
                        
                        # Send response
                        router.send(sender, RESP_PREFIX, output)
                        print(f"✅ Response sent to {sender}")
                    
                    elif parsed["type"] == "resp":
                        sender = parsed["sender"]
                        content = parsed["content"]
                        print(f"\n📥 RESPONSE from {sender}: {content[:200]}")
                        
                        # Store in DB for retrieval
                        db.execute("""INSERT OR REPLACE INTO messages VALUES 
                            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (parsed["msg_id"], sender, MACHINE_ID, "telegram", RESP_PREFIX,
                             content, time.time(), "received", 1, 1))
                        db.commit()
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print("\nListener stopped")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    run_listener()
