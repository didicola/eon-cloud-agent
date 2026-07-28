#!/bin/bash
# EON Quantum Bot — Persistent Launcher
# Starts server + cloudflared tunnel, restarts on crash

BOT_DIR="/root/workers/quantum-bot"
LOG="/tmp/quantum-bot.log"
TUNNEL_LOG="/tmp/cf-tunnel.log"
PID_FILE="/tmp/eon-bot.pids"

kill_old() {
  [ -f "$PID_FILE" ] && while read p; do kill -9 "$p" 2>/dev/null; done < "$PID_FILE"
  pkill -9 -f "node api/index" 2>/dev/null
  pkill -9 -f "cloudflared tunnel" 2>/dev/null
  sleep 1
}

start_server() {
  cd "$BOT_DIR"
  node api/index.js >> "$LOG" 2>&1 &
  echo $! >> "$PID_FILE"
  sleep 1
  kill -0 $(tail -1 "$PID_FILE") 2>/dev/null && echo "[✓] Server started" || echo "[✗] Server failed"
}

start_tunnel() {
  cloudflared tunnel --url http://localhost:3000 --no-autoupdate >> "$TUNNEL_LOG" 2>&1 &
  echo $! >> "$PID_FILE"
  sleep 8
  URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$TUNNEL_LOG" | tail -1)
  if [ -n "$URL" ]; then
    echo "[✓] Tunnel: $URL"
    echo "$URL" > /tmp/eon-tunnel-url.txt
    # Auto-set webhook
    curl -s --max-time 10 "https://api.telegram.org/bot8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow/setWebhook" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"url\":\"${URL}/webhook\",\"max_connections\":40,\"allowed_updates\":[\"message\"]}" | \
      python3 -c "import json,sys; d=json.load(sys.stdin); print('[✓] Webhook:', 'OK' if d.get('ok') else 'FAIL')"
  else
    echo "[✗] Tunnel failed"
  fi
}

watchdog() {
  while true; do
    sleep 30
    if ! curl -s --max-time 3 http://localhost:3000/health > /dev/null 2>&1; then
      echo "[$(date)] Server dead, restarting..."
      echo "" > "$LOG"
      start_server
      start_tunnel
    fi
  done
}

echo "=== EON Quantum Bot Launcher ==="
kill_old
echo "" > "$LOG"
echo "" > "$TUNNEL_LOG"
> "$PID_FILE"
start_server
start_tunnel
echo ""
echo "Logs: tail -f $LOG"
echo "Webhook URL: $(cat /tmp/eon-tunnel-url.txt 2>/dev/null)"
echo ""
watchdog
