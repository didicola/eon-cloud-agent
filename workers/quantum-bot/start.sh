#!/bin/bash
# EON AGI v6.0 — Persistent Launcher with Watchdog
BOT_DIR="/root/workers/quantum-bot"
LOG="/tmp/quantum-bot.log"
TUNNEL_LOG="/tmp/cf-tunnel.log"

cleanup() {
  ps aux | grep -E "node api/index|cloudflared tunnel" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null
}
trap cleanup EXIT

start_server() {
  cd "$BOT_DIR"
  setsid node api/index.js >> "$LOG" 2>&1 &
  disown
  sleep 2
  curl -s --max-time 3 http://localhost:3000/health > /dev/null 2>&1 && echo "[✓] Server alive" || echo "[✗] Server dead"
}

start_tunnel() {
  grep -q "trycloudflare.com" "$TUNNEL_LOG" 2>/dev/null && return
  setsid cloudflared tunnel --url http://localhost:3000 --no-autoupdate >> "$TUNNEL_LOG" 2>&1 &
  disown
  sleep 8
  URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$TUNNEL_LOG" | tail -1)
  if [ -n "$URL" ]; then
    echo "$URL" > /tmp/eon-tunnel-url.txt
    echo "[✓] Tunnel: $URL"
    curl -s --max-time 10 "https://api.telegram.org/bot8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow/setWebhook" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"url\":\"${URL}/webhook\",\"max_connections\":40,\"allowed_updates\":[\"message\"]}" | \
      python3 -c "import json,sys; d=json.load(sys.stdin); print('[✓] Webhook: OK' if d.get('ok') else '[✗] Webhook: FAIL')"
  fi
}

echo "=== EON AGI v6.0 Launcher ==="
cleanup
> "$LOG"
> "$TUNNEL_LOG"
start_server
start_tunnel
echo ""
echo "URL: $(cat /tmp/eon-tunnel-url.txt 2>/dev/null)"
echo "Logs: tail -f $LOG"
echo ""

# Watchdog: restart every 30s if dead
while true; do
  sleep 30
  if ! curl -s --max-time 3 http://localhost:3000/health > /dev/null 2>&1; then
    echo "[$(date)] Watchdog: restarting..."
    > "$LOG"
    > "$TUNNEL_LOG"
    start_server
    start_tunnel
  fi
done
