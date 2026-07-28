#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# EON FULL UPDATE — Run this on Ubuntu machine
# ═══════════════════════════════════════════════════════════════════════
set -e
echo "🧠 EON FULL UPDATE — v8.0 AGI + All Upgrades"

# 1. Pull latest from GitHub
echo "━━━ 1. Pulling from GitHub ━━━"
cd /root/eon-cloud-agent 2>/dev/null || { echo "Cloning repo..."; git clone https://github.com/didicola/eon-cloud-agent.git /root/eon-cloud-agent; cd /root/eon-cloud-agent; }
git pull origin main

# 2. Install Node.js server (v8.0 AGI)
echo "━━━ 2. Installing Node.js AGI server ━━━"
mkdir -p /root/workers/quantum-bot/api
cp /root/eon-cloud-agent/quantum-bot-api-index.js /root/workers/quantum-bot/api/index.js
cp /root/eon-cloud-agent/agi-upgrade.js /root/workers/quantum-bot/api/agi-upgrade.js

# 3. Package.json
echo "━━━ 3. Setting up package.json ━━━"
if [ ! -f /root/workers/quantum-bot/package.json ]; then
  cat > /root/workers/quantum-bot/package.json << 'PKG'
{
  "name": "eon-quantum-bot",
  "version": "8.0",
  "private": true,
  "scripts": {
    "start": "node api/index.js"
  }
}
PKG
fi

# 4. Install Python AGI brain v6.0
echo "━━━ 4. Installing Python AGI brain v6.0 ━━━"
cp /root/eon-cloud-agent/eon_mega_brain_v6.py /root/eon_mega_brain_v6.py
cp /root/eon-cloud-agent/eon_mega_brain_v6.py /root/eon_mega_brain.py
chmod +x /root/eon_mega_brain.py

# 5. Install watchdog
echo "━━━ 5. Installing watchdog ━━━"
cp /root/eon-cloud-agent/eon-watchdog.sh /root/eon-watchdog.sh
chmod +x /root/eon-watchdog.sh

# 6. Install start script
echo "━━━ 6. Installing start script ━━━"
cp /root/eon-cloud-agent/start.sh /root/workers/quantum-bot/start.sh
chmod +x /root/workers/quantum-bot/start.sh

# 7. Install systemd services (if systemd available)
echo "━━━ 7. Installing services ━━━"
if command -v systemctl &>/dev/null && pidof systemd &>/dev/null; then
  cp /root/eon-cloud-agent/systemd/*.service /etc/systemd/system/ 2>/dev/null
  systemctl daemon-reload
  systemctl enable eon-agi eon-tunnel 2>/dev/null
  echo "Systemd services installed"
else
  echo "No systemd — using crontab watchdog"
fi

# 8. Install Python deps
echo "━━━ 8. Installing Python dependencies ━━━"
pip3 install scikit-learn 2>/dev/null || pip3 install --break-system-packages scikit-learn 2>/dev/null || true

# 9. Install /usr/local/bin/eon
echo "━━━ 9. Installing eon CLI ━━━"
cat > /usr/local/bin/eon << 'BIN'
#!/usr/bin/env python3
import sys
sys.path.insert(0, "/root")
from eon_mega_brain import run_chat, chat, system_info, version_create, version_list, version_switch

if len(sys.argv) > 1:
    cmd = sys.argv[1]
    if cmd == 'status':
        import json; print(json.dumps(system_info(), indent=2))
    elif cmd == 'version':
        sub = sys.argv[2] if len(sys.argv) > 2 else 'list'
        if sub == 'list':
            for v in version_list(): print(f"{v['name']} — {v.get('description', '')} ({v.get('created', '')})")
        elif sub.startswith('create'):
            r = version_create(sys.argv[3] if len(sys.argv) > 3 else 'custom'); print(f"Created: {r}")
        else: print(version_switch(sub))
    elif cmd == 'think':
        prompt = ' '.join(sys.argv[2:]); result = chat(prompt); print(result['response'])
    elif cmd == 'memory':
        from eon_mega_brain import memory; import json; print(json.dumps(memory.get_stats(), indent=2))
    else:
        prompt = ' '.join(sys.argv[1:]); result = chat(prompt); print(result['response'])
else:
    run_chat()
BIN
chmod +x /usr/local/bin/eon

# 10. Stop old processes
echo "━━━ 10. Stopping old processes ━━━"
pkill -f "node api/index.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 2

# 11. Start server
echo "━━━ 11. Starting AGI server ━━━"
cd /root/workers/quantum-bot && setsid node api/index.js > /tmp/quantum-bot.log 2>&1 &
disown
sleep 3

# 12. Start tunnel
echo "━━━ 12. Starting cloudflared tunnel ━━━"
setsid cloudflared tunnel --url http://localhost:3000 --no-autoupdate > /tmp/cf-chat.log 2>&1 &
disown
sleep 20

# 13. Set webhook
echo "━━━ 13. Setting webhook ━━━"
URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/cf-chat.log | tail -1)
if [ -n "$URL" ]; then
    curl -s --max-time 20 "https://api.telegram.org/bot8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow/setWebhook" \
        -X POST -H "Content-Type: application/json" \
        -d "{\"url\":\"${URL}/webhook\",\"max_connections\":40,\"allowed_updates\":[\"message\"]}"
    echo ""
    echo "Webhook set to: $URL"
else
    echo "WARNING: Could not get tunnel URL"
fi

# 14. Set crontab watchdog
echo "━━━ 14. Setting watchdog cron ━━━"
(crontab -l 2>/dev/null | grep -v "eon-watchdog"; echo "* * * * * /root/eon-watchdog.sh >> /tmp/eon-cron.log 2>&1") | crontab -
echo "Watchdog active"

# 15. Verify
echo "━━━ 15. Verifying ━━━"
sleep 5
tail -5 /tmp/quantum-bot.log
echo "---"
curl -s --max-time 10 http://localhost:3000/health | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Status: {d[\"status\"]} | Version: {d[\"version\"]} | Messages: {d[\"stats\"][\"messages\"]}')" 2>/dev/null || echo "Server not responding yet"
echo "---"
echo "✅ EON FULL UPDATE COMPLETE!"
echo "🌐 Tunnel: $URL"
echo "🤖 Bot: @Ririmobot"
echo "📊 Watchdog: every 60s"
