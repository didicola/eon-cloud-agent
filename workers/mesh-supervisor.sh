#!/bin/bash
while true; do
  if ! pgrep -f "node mesh-host.js" > /dev/null; then
    cd /root/eon-cloud-agent/workers && setsid nohup node mesh-host.js >> /tmp/mesh-host.log 2>&1 &
    echo "$(date -u +%FT%TZ) [supervisor] restarted mesh-host" >> /tmp/mesh-host.log
  fi
  sleep 20
done
