#!/usr/bin/env python3
"""
🜂 EON MATRIX SEND — Send commands to remote machine via Matrix Router
Usage: python3 eon_matrix_send.py ubuntu "hostname"
"""
import urllib.request, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eon_matrix_router import router, gen_msg_id, MACHINE_ID

def send_and_wait(receiver, cmd, timeout=60):
    """Send command and wait for response"""
    msg_id = router.send(receiver, "!CMD", cmd)
    
    if not msg_id:
        print("❌ Failed to send command")
        return None
    
    print(f"  ⏳ Waiting for response (timeout: {timeout}s)...")
    
    start = time.time()
    while time.time() - start < timeout:
        # Check DB for response
        row = router.db.execute(
            "SELECT content FROM messages WHERE sender=? AND prefix='!RESP' AND status='received' ORDER BY timestamp DESC LIMIT 1",
            (receiver,)
        ).fetchone()
        
        if row:
            # Check if it's recent (within our wait period)
            recent = router.db.execute(
                "SELECT timestamp FROM messages WHERE sender=? AND prefix='!RESP' ORDER BY timestamp DESC LIMIT 1",
                (receiver,)
            ).fetchone()
            
            if recent and recent[0] > start - 5:
                print(f"\n📥 RESPONSE from {receiver}:")
                print(row[0])
                return row[0]
        
        time.sleep(2)
    
    print("\n⚠️ Timeout waiting for response")
    return None

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 eon_matrix_send.py <receiver> <command>")
        print("Example: python3 eon_matrix_send.py ubuntu \"ls -la\"")
        sys.exit(1)
    
    receiver = sys.argv[1]
    cmd = " ".join(sys.argv[2:])
    
    print(f"📤 Sending to {receiver}: {cmd}")
    result = send_and_wait(receiver, cmd)
    
    if result:
        print(f"\n✅ Success")
    else:
        print(f"\n❌ No response")
