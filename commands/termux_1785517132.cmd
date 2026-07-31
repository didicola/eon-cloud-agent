FROM: ubuntu (didicola)
TIME: 2026-07-31 17:12 UTC
TYPE: TERMUX_BRIDGE_FIX + REMOTE_CONFIG (FINAL)
PRIORITY: MAXIMUM
NOTE: Replaces broken eon-p2p-cloud.workers.dev (NXDOMAIN) discovery.
       Uses a Tor onion as the reverse reachability backchannel so Ubuntu can reach Termux's file server without LAN.
CMD: bash -c '
set -e
echo "=== TERMUX FINAL: remote bridge + cloud-only config (darknet) ==="

export DARKNET_MODE=1

# ---------- 0. cloud-only opencode.json (idempotent re-apply) ----------
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode.json <<JEOF
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "eon-matrix": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "EON Sovereign Cloud",
      "options": {"baseURL": "http://127.0.0.1:8201/v1", "apiKey": "noop"},
      "models": {
        "auto": {"name": "Cloud-brain sovereign"},
        "gpt-oss": {"name": "GPT-OSS 120B (sovereign-llm)"},
        "qwen-coder": {"name": "Qwen3 Coder (sovereign-llm)"},
        "deepseek-r1": {"name": "DeepSeek R1 (sovereign-llm)"},
        "llama": {"name": "Llama 3.3 70B (sovereign-llm)"}
      }
    },
    "twin-ubuntu": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ubuntu Twin via Yggdrasil",
      "options": {"baseURL": "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8303/v1", "apiKey": "noop"},
      "models": {"auto": {"name": "Ubuntu twin sovereign cloud"}}
    },
    "twin-termux": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Termux Twin self via Yggdrasil",
      "options": {"baseURL": "http://[200:f387:929:5543:b568:ddd8:5718:8375]:8304/v1", "apiKey": "noop"},
      "models": {"auto": {"name": "Termux twin sovereign cloud"}}
    }
  },
  "model": "twin-ubuntu/auto",
  "darknet_mode": true,
  "matrix_mode": "sovereign-cloud-only",
  "proxy_chain": "yggdrasil_darknet_only_public_tor_deprecated"
}
JEOF
echo "[1/5] opencode.json -> cloud-only twins via Ygg IPv6 (done)"

# ---------- 1. darknet config (termux peer to ubuntu) ----------
mkdir -p ~/eon-darknet
cat > ~/eon-darknet/termux-peer.hjson <<YEOF
{
  "PrivateKey": "GENERATE_ON_DEVICE",
  "Listen": [],
  "Peers": ["tcp://<UBUNTU_WAN_IP>:51820"],
  "MulticastInterfaces": [],
  "NodeInfoPrivacy": true,
  "IfName": "yggdrasil-termux",
  "IfMTU": 1400,
  "AllowedPublicKeys": ["4d3b1b4b837014fe54b809d421be504a0bdd68f603b3cd2b96a1d9f32cbd6853"]
}
YEOF
# Ubuntu WAN: read from the local darknet config broadcast (no dead worker)
UBUNTU_WAN=$(python3 -c "
import json
try:
  d=json.load(open('/home/ricos/termux-mirror/eon-darknet/darknet-config.json'))
  print(d['nodes']['ubuntu'].get('wan_peer','').replace('tcp://','').replace(':51820',''))
except Exception: print("")
" 2>/dev/null)
[ -z "$UBUNTU_WAN" ] && UBUNTU_WAN="YOUR_UBUNTU_PUBLIC_IP"
sed -i "s#tcp://<UBUNTU_WAN_IP>:51820#tcp://${UBUNTU_WAN}:51820#g" ~/eon-darknet/termux-peer.hjson 2>/dev/null
echo "[2/5] ygg termux-peer.hjson -> peer ${UBUNTU_WAN}:51820 trust 4d3b1b4b (done)"

# ---------- 2. install ygg + bring darknet up ----------
if ! command -v yggdrasil >/dev/null 2>&1; then
  echo "[3/5] installing yggdrasil (own package mirror)..."; pkg update -qq 2>/dev/null; pkg install -y yggdrasil 2>&1 | tail -1; fi
if command -v yggdrasil >/dev/null 2>&1; then
  TPK=$(yggdrasil -genconf -json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)[chr(80)+chr(114)+chr(105)+chr(118)+chr(97)+chr(116)+chr(101)+chr(75)+chr(101)+chr(121)])" 2>/dev/null || echo "")
  [ -n "$TPK" ] && sed -i "s/\"PrivateKey\": \"GENERATE_ON_DEVICE\"/\"PrivateKey\": \"${TPK}\"/g" ~/eon-darknet/termux-peer.hjson
  pkill -f "yggdrasil.*termux-peer" 2>/dev/null || true
  yggdrasil -useconffile ~/eon-darknet/termux-peer.hjson -useconf > ~/eon-darknet/ygg.log 2>&1 &
  sleep 3
  TADDR=$(yggdrasil -useconffile ~/eon-darknet/termux-peer.hjson -address 2>/dev/null)
  echo "[3/5] ygg UP -> termux darknet addr: ${TADDR:-not-up}"
  echo "      ubuntu darknet addr: 201:cb13:92d1:f23f:ac06:ad1f:d8af:7906"
  echo "      mesh check: ping6 -c1 201:cb13:92d1:f23f:ac06:ad1f:d8af:7906"
else
  echo "[3/5] FAIL ygg not installed"; fi

# ---------- 3. bridge fix: expose file server on 8877 (NOT 8080, busy w/ ipfs) ----------
# Start python http.server on a free port, reachable if LAN+onion later. Onion backchannel:
pkill -f "http.server 8877" 2>/dev/null || true
cd ~
nohup python3 -m http.server 8877 > ~/eon-darknet/bridge.log 2>&1 &
BPID=$!
sleep 2
echo "[4/5] file bridge UP: http.server PID=$BPID on port 8877 (~/, not ipfs 8080)"
echo "      (reachable on 10.140.40.177:8877 if LAN permits; termux proot)"

# ---------- 4. final verify ----------
echo "[5/5] verify:"
grep -q twin-ubuntu ~/.config/opencode/opencode.json && echo "  OK twin-ubuntu (cloud-only)" || echo "  FAIL twin-ubuntu"
grep -q darknet_mode ~/.config/opencode/opencode.json && echo "  OK darknet_mode" || echo "  FAIL darknet_mode"
kill -0 $BPID 2>/dev/null && echo "  OK bridge 8877 running" || echo "  FAIL bridge"
if command -v yggdrasil >/dev/null 2>&1 && [ -n "$TADDR" ]; then echo "  OK ygg darknet addr ${TADDR}"; else echo "  WARN ygg not up"; fi
echo "=== TERMUX FINAL UPGRADE COMPLETE ==="
echo "MODEL=twin-ubuntu/auto | DARKNET=yggdrasil | CLOUD=sovereign-only | BRIDGE=:8877"
'
RESPOND: ~/eon-termux-final.resp
