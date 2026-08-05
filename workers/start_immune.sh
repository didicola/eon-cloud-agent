#!/bin/bash
# start_immune.sh — install + launch the Sovereign Autonomic/IMMUNE daemons (proot-compatible).
# Idempotent single-instance guards (flock). Launches the Digital Immune System + Autonomic
# Nervous System + Round-Matrix Sync in the background. Golden-rule compliant (no earthly).
# Usage: bash workers/start_immune.sh
cd "$(dirname "$0")/.." || exit 1
W=workers
mklog() { echo "$(date -u +%FT%TZ) $1"; }

exec 9>/tmp/eon-immune.lock
flock -n 9 || { mklog "instance already running (flock held)"; exit 0; }

for d in eon_self_heal_daemon eon_local_immunity round_matrix_daemon; do
  if ! pgrep -f "python3 -u $d[.].py" >/dev/null 2>&1; then
    setsid nohup python3 -u "$W/$d.py" >> "/tmp/$d.log" 2>&1 &
    mklog "$d started (pid $!)"
  else
    mklog "$d already running"
  fi
done
sleep 2
mklog "immune launch complete"
ps aux | grep -E "[e]on_self_heal_daemon|[e]on_local_immunity|[r]ound_matrix_daemon" | grep -v grep | awk '{print "  ", $2, $11, $12}'