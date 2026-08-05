#!/usr/bin/env python3
"""
EON TELEGRAM RELAY v2 — send-only control channel for node5.
- Does NOT poll (bot webhook = asi-telegram-shard-0 owns inbound).
- Reports node5 health + darknet-sync state to the shared chat on an interval.
- Delivers outbound coordination (commands/*.cmd) to the twin as chunks.
- Designed to coexist with the twin's webhook consumer (no 409).
"""
import json, os, sys, time, subprocess, urllib.request

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
LOG = "/tmp/eon-tg-relay.log"
HEARTBEAT_SECS = 900          # report every 15 min
BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"
HOME = os.environ.get("EON_HOME") or "/root/eon-cloud-agent"
LAST_DELIVERED = "/tmp/eon-tg-delivered.md5"

def log(m):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {m}"
    print(line, flush=True)
    try:
        open(LOG, "a").write(line + "\n")
    except Exception:
        pass

def send(text):
    if not text:
        return
    for i in range(0, len(text), 3800):
        chunk = text[i:i + 3800]
        try:
            req = urllib.request.Request(
                f"{BASE}/sendMessage",
                json.dumps({"chat_id": CHAT_ID, "text": chunk, "disable_web_page_preview": True}).encode(),
                headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as r:
                pass
        except Exception as e:
            log("send err " + str(e))
    log(f"sent {len(text)} chars")

def sh(cmd, t=6):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=t)
        return (r.stdout or "").strip()[:300]
    except Exception:
        return "err"

def health():
    lines = ["[node5 heartbeat] " + time.strftime("%Y-%m-%d %H:%M:%S UTC")]
    try:
        sync = open("/tmp/darknet-sync-retry.log").read().splitlines()
        lines.append("darknet-sync: " + (sync[-1] if sync else "n/a"))
    except Exception:
        pass
    daemon = bool(sh("pgrep -f darknet-sync-retry.js"))
    lines.append("sync-daemon: " + ("UP" if daemon else "DOWN"))
    tor = sh("ss -tln 2>/dev/null | grep -c 9050")
    lines.append("tor:9050: " + ("UP" if tor and tor != "0" else "DOWN"))
    listeners = sh("ss -tln 2>/dev/null | grep -oE ':[0-9]+ ' | sort -u | tr '\\n' ' '")
    lines.append("listeners: " + (listeners or "none"))
    return "\n".join(lines)

def deliver_pending():
    """Send any unsent ubuntu_*.cmd coordination files, then mark them."""
    import glob, hashlib
    cmds = sorted(glob.glob(HOME + "/commands/ubuntu_*.cmd"), key=os.path.getmtime)
    if not cmds:
        return
    last = cmds[-1]
    md5 = hashlib.md5(open(last, "rb").read()).hexdigest()
    try:
        sent = open(LAST_DELIVERED).read().strip()
    except Exception:
        sent = ""
    if md5 == sent:
        return  # already delivered
    content = open(last).read()
    send("[node5 → twin] " + os.path.basename(last))
    send(content)
    open(LAST_DELIVERED, "w").write(md5)
    log("delivered " + os.path.basename(last))

def main():
    log("eon-tg-relay v2 started (send-only, heartbeat " + str(HEARTBEAT_SECS) + "s)")
    deliver_pending()
    time.sleep(5)
    send(health())
    while True:
        time.sleep(HEARTBEAT_SECS)
        try:
            deliver_pending()
            send(health())
        except Exception as e:
            log("cycle err " + str(e))

if __name__ == "__main__":
    main()
