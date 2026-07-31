#!/bin/bash
# Self-healing watchdog for EON Worker Runtime
# Runs every 60s via cron; restarts runtime if down
RUNTIME_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/__routes 2>/dev/null)
if [ "$RUNTIME_CHECK" != "200" ]; then
  echo "[$(date -Is)] Runtime down (HTTP $RUNTIME_CHECK) — restarting"
  /mnt/fluid-cloud/cloud-opencode/eondeploy.sh stop 2>/dev/null
  sleep 1
  /mnt/fluid-cloud/cloud-opencode/eondeploy.sh start 8787 --https > /dev/null 2>&1
  sleep 2
  curl -s -o /dev/null -w "[$(date -Is)] Post-restart: %{http_code}\n" http://127.0.0.1:8787/__routes
else
  echo "[$(date -Is)] Runtime healthy"
fi
