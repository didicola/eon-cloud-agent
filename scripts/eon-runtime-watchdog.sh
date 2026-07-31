#!/bin/bash
# Self-healing watchdog for EON Worker Runtime
# Runs every 60s via cron; restarts runtime if health check fails
TOKEN_FILE=/tmp/eon_runtime.token
TOKEN=""
[ -f "$TOKEN_FILE" ] && TOKEN=$(cat "$TOKEN_FILE")
HEALTH=$(curl -s -H "x-eon-token: $TOKEN" http://127.0.0.1:8787/__health 2>/dev/null)
if ! echo "$HEALTH" | python3 -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if d.get('status')=='ok' else 1)" 2>/dev/null; then
  echo "[$(date -Is)] Runtime unhealthy — restarting"
  /mnt/fluid-cloud/cloud-opencode/eondeploy.sh stop 2>/dev/null
  sleep 1
  /mnt/fluid-cloud/cloud-opencode/eondeploy.sh start 8787 --https > /dev/null 2>&1
  sleep 2
  curl -s -H "x-eon-token: $TOKEN" -o /dev/null -w "[$(date -Is)] Post-restart health: %{http_code}\n" http://127.0.0.1:8787/__health
else
  echo "[$(date -Is)] Runtime healthy"
fi
