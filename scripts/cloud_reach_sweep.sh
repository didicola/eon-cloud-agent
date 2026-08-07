#!/bin/bash
echo "=== CLOUD REACH SWEEP $(date -u) ==="
echo "-- workers inventory --"
for h in eon-p2p-cloud asi-telegram-shard-0 cloud-brain-proxy eon-cloud-worker; do
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -A "Mozilla/5.0" "https://$h.exportdefaultasyncfetchrequestenvconsturl.workers.dev/" 2>/dev/null)
  echo "$h = $code"
done
echo "-- yggdrasil public mesh probe to ubuntu --"
if ! command -v yggdrasil >/dev/null 2>&1; then
  YGG_VER=$(curl -s -m 10 "https://api.github.com/repos/yggdrasil-network/yggdrasil-go/releases/latest" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
  YGG_VER=${YGG_VER#v}
  echo "ygg version: $YGG_VER"
  URL="https://github.com/yggdrasil-network/yggdrasil-go/releases/download/$YGG_VER/yggdrasil-${YGG_VER}-linux-amd64.tar.gz"
  curl -sL -m 120 -o /tmp/ygg.tar.gz "$URL" && tar xzf /tmp/ygg.tar.gz -C /tmp/ 2>/dev/null
  BIN=$(find /tmp -name yggdrasil -type f 2>/dev/null | head -1)
  if [ -z "$BIN" ]; then echo "YGG DOWNLOAD FAILED"; else export PATH="$(dirname $BIN):$PATH"; fi
fi
if command -v yggdrasil >/dev/null 2>&1; then
  cat > /tmp/ygg.conf <<'CFG'
{
  "Peers": ["tcp://95.216.6.24:59432","tcp://94.140.114.3:444","tcp://163.172.143.172:49382","tcp://194.5.85.99:42042","tcp://217.12.204.174:12345"],
  "Listen": [],
  "MulticastInterfaces": [],
  "IfName": "ygg0",
  "IfMTU": 65535,
  "NodeInfoPrivacy": false
}
CFG
  yggdrasil -useconffile /tmp/ygg.conf -logto /tmp/ygg.log &
  YGGPID=$!
  sleep 18
  ADDR=$(yggdrasilctl getself 2>/dev/null | grep -oE '200:[0-9a-f:]+' | head -1)
  echo "cloud ygg addr: $ADDR"
  echo "ygg log tail:"; tail -5 /tmp/ygg.log 2>/dev/null
  echo "-- probe ubuntu ygg --"
  timeout 10 curl -s -m 6 -o /dev/null -w 'ubuntu:8090=%{http_code}\n' "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8090/" 2>/dev/null || echo "ubuntu:8090 unreachable"
  timeout 10 curl -s -m 6 -o /dev/null -w 'ubuntu:8200=%{http_code}\n' "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8200/" 2>/dev/null || echo "ubuntu:8200 unreachable"
  kill $YGGPID 2>/dev/null
else
  echo "yggdrasil not available"
fi
echo "=== SWEEP DONE ==="
