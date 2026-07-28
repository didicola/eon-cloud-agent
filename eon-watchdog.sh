#!/bin/bash
# EON Persistent Watchdog — checks every 60s, restarts if needed
# Crontab: * * * * * /root/eon-watchdog.sh
LOG="/tmp/eon-watchdog.log"
BOT_TOKEN="8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
LOG_MAX=2000

log() { echo "[$(date '+%H:%M:%S')] $1" >> "$LOG"; }

# Check Node.js server
if ! pgrep -f "node api/index.js" > /dev/null 2>&1; then
    log "RESTART: node server"
    cd /root/workers/quantum-bot && setsid node api/index.js > /tmp/quantum-bot.log 2>&1 &
    disown
    sleep 5
fi

# Check cloudflared tunnel
if ! pgrep -f "cloudflared tunnel" > /dev/null 2>&1; then
    log "RESTART: cloudflared tunnel"
    rm -f /tmp/cf-chat.log
    setsid cloudflared tunnel --url http://localhost:3000 --no-autoupdate > /tmp/cf-chat.log 2>&1 &
    disown
    sleep 20
    URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" /tmp/cf-chat.log | tail -1)
    if [ -n "$URL" ]; then
        curl -s --max-time 20 "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
            -X POST -H "Content-Type: application/json" \
            -d "{\"url\":\"${URL}/webhook\",\"max_connections\":40,\"allowed_updates\":[\"message\"]}" > /dev/null 2>&1
        log "WEBHOOK: set to $URL"
    fi
fi

# Prune logs
if [ -f /tmp/quantum-bot.log ]; then
    LINES=$(wc -l < /tmp/quantum-bot.log)
    if [ "$LINES" -gt $LOG_MAX ]; then
        tail -1000 /tmp/quantum-bot.log > /tmp/quantum-bot.log.tmp
        mv /tmp/quantum-bot.log.tmp /tmp/quantum-bot.log
        log "PRUNED: quantum-bot.log ($LINES → 1000)"
    fi
fi

# Prune watchdog log
WLINES=$(wc -l < "$LOG" 2>/dev/null || echo 0)
if [ "$WLINES" -gt 500 ]; then
    tail -200 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi
