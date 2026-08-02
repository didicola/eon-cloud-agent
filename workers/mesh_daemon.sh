#!/bin/bash
MESH="${MESH_URL:-http://127.0.0.1:8787}"
NODE_ID="node5"
INTERVAL=${1:-300}
ONION="o3izfmjjt2pmsgauio7fau3ykiwm5ion4ltojv7zegdpp7n74tfqsqad.onion"

echo "[mesh] Starting daemon for $NODE_ID (${INTERVAL}s) -> $MESH"

curl -s -A "Mozilla/5.0" -X POST "$MESH/mesh/register?node_id=$NODE_ID" \
  -H "Content-Type: application/json" \
  -d "{\"node_id\":\"node5\",\"ip\":\"127.0.0.1\",\"addr\":\"$ONION\",\"capabilities\":[\"compute\",\"storage\",\"relay\",\"dns\",\"matrix\",\"messenger\",\"timing\",\"monero\",\"cloud-brain\"],\"services\":{\"mesh\":8787,\"matrix\":8201,\"messenger\":9250}}" \
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
