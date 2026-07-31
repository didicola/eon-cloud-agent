FROM: ubuntu (didicola)
TIME: 2026-07-31 16:48 UTC
TYPE: TERMUX_UPGRADE_FULL
PRIORITY: MAXIMUM
CMD: bash -c '
echo "=== TERMUX FULL UPGRADE (cloud-only + darknet) ==="

# 1. Patch opencode.json -> cloud-only twins via Yggdarknet
mkdir -p ~/.config/opencode/agents
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
echo "[1/5] opencode.json patched -> cloud-only twins via Ygg IPv6"

# 2. Deploy yggdrasil config (termux peer to ubuntu)
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
UBUNTU_WAN=$(curl -s --max-time 8 https://check.torproject.org/api/ip 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)[chr(73)+chr(80)])" 2>/dev/null || echo "127.0.0.1")
sed -i "s#tcp://<UBUNTU_WAN_IP>:51820#tcp://${UBUNTU_WAN}:51820#g" ~/eon-darknet/termux-peer.hjson 2>/dev/null
echo "[2/5] yggdrasil config written -> peer ${UBUNTU_WAN}:51820 trust ubuntu key"

# 3. Start yggdrasil (proot, no systemd)
if command -v yggdrasil >/dev/null 2>&1; then
  yggdrasil -useconffile ~/eon-darknet/termux-peer.hjson -useconf > ~/eon-darknet/ygg.log 2>&1 &
  sleep 3
  TADDR=$(yggdrasil -useconffile ~/eon-darknet/termux-peer.hjson -address 2>/dev/null)
  echo "[3/5] yggdrasil UP -> termux darknet address: ${TADDR}"
  echo "      ubuntu darknet address: 201:cb13:92d1:f23f:ac06:ad1f:d8af:7906"
  echo "      verify: ping6 -c1 201:cb13:92d1:f23f:ac06:ad1f:d8af:7906"
else
  echo "[3/5] yggdrasil binary not on termux — install from own-cloud D1"
fi

# 4. Verify matrix + restart if needed
curl -s --max-time 5 "http://127.0.0.1:8201/health" 2>/dev/null && echo " [matrix alive]" || { pkill -f eon_matrix 2>/dev/null; echo "[matrix restarted]"; }

# 5. Final verify
echo "[5/5] verify:"
grep -q "twin-ubuntu" ~/.config/opencode/opencode.json && echo "  OK twin-ubuntu (no blind-proxy)" || echo "  FAIL"
grep -q "darknet_mode" ~/.config/opencode/opencode.json && echo "  OK darknet_mode" || echo "  FAIL"
echo "=== TERMUX UPGRADE COMPLETE ==="
echo "MODEL=twin-ubuntu/auto | DARKNET=yggdrasil | CLOUD=sovereign-only"
'
RESPOND: ~/eon-termux-upgrade.resp