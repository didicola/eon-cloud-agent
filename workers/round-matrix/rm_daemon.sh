#!/bin/bash
# EON Round Matrix v3.0 — Node5 Heartbeat Daemon
MESH="https://eon-round-matrix.pleasant-bobble.workers.dev"
NODE_ID="node5"
INTERVAL=${1:-300}
UA="Mozilla/5.0"
CURL="curl -s -A $UA -m 10"
H="-H Content-Type: application/json"

echo "[rm] Starting Round Matrix daemon for $NODE_ID (${INTERVAL}s)"

$CURL -X POST "$MESH/router/register?node_id=$NODE_ID" $H \
  -d '{"node_id":"node5","ip":"127.0.0.1","capabilities":["compute","storage","relay","dns","brain"]}' > /dev/null 2>&1 \
  && echo "[rm] Registered"

CYCLE=0
while true; do
  CYCLE=$((CYCLE + 1))
  $CURL -X POST "$MESH/router/heartbeat?node_id=$NODE_ID" $H \
    -d "{\"node_id\":\"$NODE_ID\"}" > /dev/null 2>&1

  # Watcher ping
  $CURL -X POST "$MESH/watcher/ping" $H \
    -d "{\"node_id\":\"$NODE_ID\",\"latency\":5}" > /dev/null 2>&1

  if [ $((CYCLE % 3)) -eq 0 ]; then
    PEERS=$($CURL "$MESH/router/peers?node_id=$NODE_ID" 2>/dev/null | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('peers',[])))" 2>/dev/null)
    WATCH=$($CURL "$MESH/watcher/status" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin).get('count',0))" 2>/dev/null)
    echo "[rm] $PEERS peers | $WATCH watched (cycle $CYCLE)"
  fi

  sleep $INTERVAL
done
