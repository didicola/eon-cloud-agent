#!/bin/bash
# darknet-sync-retry.sh — persistent launcher for the delivery daemon
# Respawns the node daemon if it exits. Idempotent (won't double-start).
LOGDIR=/tmp
PIDFILE=$LOGDIR/darknet-sync-retry.pid
LOGFILE=$LOGDIR/darknet-sync-retry.log

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PIDFILE")"; exit 0
fi

while :; do
  echo $$ > "$PIDFILE"
  node /root/eon-cloud-agent/scripts/darknet-sync-retry.js >> "$LOGFILE" 2>&1
  echo "[respawn $(date -u +%H:%M:%S)] node exited, respawning in 30s" >> "$LOGFILE"
  sleep 30
done
