#!/bin/bash
# eon-tg-relay.sh — persistent launcher for the Telegram relay daemon
# Respawns the daemon if it exits. Idempotent.
LOGDIR=/tmp
PIDFILE=$LOGDIR/eon-tg-relay.pid

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  exit 0
fi

while :; do
  echo $$ > "$PIDFILE"
  python3 /root/eon-cloud-agent/scripts/eon-tg-relay.py >> /tmp/eon-tg-relay.log 2>&1
  sleep 15
done
