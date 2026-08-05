#!/bin/bash
# lan_ubuntu_access.sh — grant the twin Ubuntu box full access to this sovereign arch.
#
#  1. Verifies the LAN door (lan_sync_server, :8788) is up on this box.
#  2. Locates the twin Ubuntu on the LAN (default 192.168.1.87; override UBUNTU_IP).
#  3. Registers the Ubuntu as a full-access mesh node (node-id ubuntu-local).
#  4. Prints the exact commands the Ubuntu box runs to browse + write this tree.
#
# The LAN door gives read access to the whole tree; writes/creates/deletes are
# gated by the mesh bearer token (same as every other mutating mesh API).
# Usage:  bash workers/lan_ubuntu_access.sh [192.168.1.87]
set -e

W="/root/eon-cloud-agent"
UBUNTU_IP="${1:-192.168.1.87}"
LAN_IP="192.168.1.146"
PORT=8788
NODE_ID="ubuntu-local"
TOKEN=$(grep -oP 'EON_ACCESS_TOKEN=\K.*' "$W/state/.mesh-token.env" 2>/dev/null || echo "")

echo "== [1/4] LAN door health =="
if curl -s -m3 "http://$LAN_IP:$PORT/health" >/dev/null 2>&1; then
  echo "  OK  door live on $LAN_IP:$PORT (root: /root/eon-cloud-agent)"
else
  echo "  UP  door not running — launching service #19"
  (cd "$W" && bash venv-run.sh "workers/lan_sync_server.py" /tmp/lan-sync-server.log)
  sleep 2
  curl -s -m3 "http://$LAN_IP:$PORT/health" | head -c 120; echo
fi

echo
echo "== [2/4] twin Ubuntu reachability =="
if timeout 3 ping -c1 -W1 "$UBUNTU_IP" >/dev/null 2>&1; then
  echo "  OK  $UBUNTU_IP responds to ping"
else
  echo "  --  $UBUNTU_IP not pingable (may ignore ICMP); probing TCP door + ssh"
fi
for p in 22 8788; do
  timeout 1 bash -c "echo >/dev/tcp/$UBUNTU_IP/$p" 2>/dev/null && echo "  OK  $UBUNTU_IP:$p reachable"
done

echo
echo "== [3/4] register Ubuntu as full-access mesh node =="
if [ -n "$TOKEN" ]; then
  RES=$(curl -s -m5 -X POST "http://127.0.0.1:8787/api/nodes" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"node_id\":\"$NODE_ID\",\"name\":\"ubuntu-local\",\"addr\":\"$UBUNTU_IP\",\"type\":\"ubuntu-twin\",\"capabilities\":[\"compute\",\"storage\",\"filesystem\"],\"services\":{\"lan\":\"$LAN_IP:$PORT\"}}" 2>/dev/null)
  echo "  $RES"
else
  echo "  !! no token found — mesh registration skipped"
fi

echo
echo "== [4/4] access credentials for the Ubuntu box =="
echo "  browse/read:  http://$LAN_IP:$PORT/browse?path=workers   (or open http://$LAN_IP:$PORT/ in a browser)"
echo "  read a file:  curl http://$LAN_IP:$PORT/read?path=workers/mesh-host.js"
echo "  full write:   curl -X PUT \"http://$LAN_IP:$PORT/write?path=workers/foo.py\" \\"
echo "                  -H \"Authorization: Bearer <TOKEN>\" --data-binary @foo.py"
echo "  new file:     curl -X POST \"http://$LAN_IP:$PORT/make?path=workers/new.py\" -H \"Authorization: Bearer <TOKEN>\""
echo "  delete:       curl -X POST \"http://$LAN_IP:$PORT/delete?path=workers/foo.py\" -H \"Authorization: Bearer <TOKEN>\""
echo
echo "  token (for the Ubuntu side):  $TOKEN"
echo "  token file shipped on this box: $W/state/.mesh-token.env (gitignored)"
echo
echo "  NOTE: if the Ubuntu's firewall blocks the LAN door, the twin can still reach"
echo "  the arch over the Tor onion via workers/twin_sync.py (dials o3izfmjjt2pmsgauio7fau3ykiwm5ion4ltojv7zegdpp7n74tfqsqad.onion)."
