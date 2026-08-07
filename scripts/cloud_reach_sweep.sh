#!/bin/bash
echo "=== CLOUD REACH SWEEP $(date -u) ==="
echo "-- workers inventory --"
for h in eon-p2p-cloud asi-telegram-shard-0 cloud-brain-proxy eon-cloud-worker; do
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -A "Mozilla/5.0" "https://$h.exportdefaultasyncfetchrequestenvconsturl.workers.dev/" 2>/dev/null)
  echo "$h = $code"
done
echo "-- yggdrasil public mesh probe to ubuntu --"
if ! command -v yggdrasil >/dev/null 2>&1; then
  echo "downloading yggdrasil deb..."
  curl -sL -m 150 -A "Mozilla/5.0" -o /tmp/ygg.deb "https://github.com/yggdrasil-network/yggdrasil-go/releases/download/v0.5.14/yggdrasil-0.5.14-amd64.deb"
  ls -la /tmp/ygg.deb 2>/dev/null
  sudo dpkg -i /tmp/ygg.deb 2>/dev/null || dpkg -i /tmp/ygg.deb 2>/dev/null || apt-get install -y /tmp/ygg.deb 2>/dev/null
fi
if command -v yggdrasil >/dev/null 2>&1; then
  yggdrasil --version 2>/dev/null || yggdrasil -version 2>/dev/null
  cat > /tmp/ygg.conf <<'CFG'
{
  "Peers": ["tcp://95.216.6.24:59432","tcp://94.140.114.3:444","tcp://163.172.143.172:49382","tcp://194.5.85.99:42042","tcp://217.12.204.174:12345","tcp://2001:67c:14:214::3:42042"],
  "Listen": [],
  "MulticastInterfaces": [],
  "IfName": "ygg0",
  "IfMTU": 65535,
  "NodeInfoPrivacy": false
}
CFG
  yggdrasil -useconffile /tmp/ygg.conf -logto /tmp/ygg.log &
  YGGPID=$!
  sleep 20
  echo "ygg log:"; tail -6 /tmp/ygg.log 2>/dev/null
  ADDR=$(yggdrasilctl getself 2>/dev/null | grep -oE '200:[0-9a-f:]+' | head -1)
  echo "cloud ygg addr: ${ADDR:-none}"
  echo "-- probe ubuntu ygg (201:cb13:92d1:f23f:ac06:ad1f:d8af:7906) --"
  timeout 12 curl -s -m 8 -o /dev/null -w 'ubuntu:8090=%{http_code}\n' "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8090/" 2>/dev/null || echo "ubuntu:8090 unreachable"
  timeout 12 curl -s -m 8 -o /dev/null -w 'ubuntu:8200=%{http_code}\n' "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8200/" 2>/dev/null || echo "ubuntu:8200 unreachable"
  timeout 12 curl -s -m 8 -o /dev/null -w 'ubuntu:3003=%{http_code}\n' "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:3003/" 2>/dev/null || echo "ubuntu:3003 unreachable"
  kill $YGGPID 2>/dev/null
else
  echo "yggdrasil install failed"
fi
echo "=== SWEEP DONE ==="
