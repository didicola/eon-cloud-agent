#!/bin/bash
exec 9>/tmp/mesh-supervisor.lock
flock -n 9 || exit 0
while true; do
  if ! pgrep -f "node mesh-host.js" > /dev/null; then
    cd /root/eon-cloud-agent/workers && setsid nohup node mesh-host.js 9>&- >> /tmp/mesh-host.log 2>&1 &
    echo "$(date -u +%FT%TZ) [supervisor] restarted mesh-host" >> /tmp/mesh-host.log
  fi
  if ! pgrep -f "tor -f /tmp/tor-min.conf" > /dev/null; then
    setsid nohup tor -f /tmp/tor-min.conf 9>&- >> /tmp/tor.log 2>&1 &
    echo "$(date -u +%FT%TZ) [supervisor] restarted tor (onion door)" >> /tmp/tor.log
  fi
  sleep 20
done
