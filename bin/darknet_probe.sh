#!/bin/bash
set -x
# Install yggdrasil on cloud VM and join the EON private darknet
which yggdrasil || (sudo apt-get update -qq && sudo apt-get install -y -qq yggdrasil 2>&1 | tail -2) || (curl -sL -o /tmp/ygg https://github.com/yggdrasil-network/yggdrasil-go/releases/latest/download/yggdrasil-0.5.12-linux-amd64.tar.gz 2>/dev/null; echo download)
cat > /tmp/cloud-peer.hjson <<'EOF'
{
  "PrivateKey": "92f3e585bc24caaca43565e0df67dc5e827f4d20c50645a7bae601174d2d9480863c7b6b555e254b9113d473be4514fc7ee995b966b2334915a3b38d0d63c4c9",
  "Peers": ["tcp://192.168.1.90:51820", "tcp://201:cb13:92d1:f23f:ac06:ad1f:d8af:7906:51820"],
  "Listen": [],
  "MulticastInterfaces": [],
  "NodeInfoPrivacy": true,
  "IfName": "ygg0",
  "IfMTU": 65535,
  "AdminListen": "unix:///tmp/yggrun.sock",
  "AllowedPublicKeys": ["4d3b1b4b837014fe54b809d421be504a0bdd68f603b3cd2b96a1d9f32cbd6853"]
}
EOF
sudo yggdrasil -useconffile /tmp/cloud-peer.hjson -useconf -logto file:///tmp/ygg.log &
sleep 8
echo "=== SELF ==="
sudo yggdrasilctl -s /tmp/yggrun.sock getself 2>&1 | head -5
echo "=== PEERS ==="
sudo yggdrasilctl -s /tmp/yggrun.sock getpeers 2>&1 | head -10
echo "=== PING UBUNTU YGG ==="
ping -c2 -W3 201:cb13:92d1:f23f:ac06:ad1f:d8af:7906 2>&1 | tail -3
echo "=== CURL UBUNTU EON-RUNTIME :8787 ==="
curl -s -m5 --connect-timeout 4 "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8787/" 2>&1 | head -c 400; echo
echo "=== CURL UBUNTU MATRIX :8201 ==="
curl -s -m5 --connect-timeout 4 "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8201/v1/models" 2>&1 | head -c 400; echo
echo DARKNET_PROBE_DONE
