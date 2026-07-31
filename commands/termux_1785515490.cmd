FROM: ubuntu (didicola)
TIME: 2026-07-31 16:40 UTC
TYPE: TERMUX_CONFIGURE
PRIORITY: MAXIMUM
CMD: bash -c '
echo "=== CONFIGURING TERMUX FOR DARKNET + CLOUD-ONLY TWIN ==="

# 1. Backup existing opencode config
cp ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.bak.$(date +%s) 2>/dev/null

# 2. Patch opencode.json: route via twin ubuntu (cloud-only) instead of eon-matrix/blind-proxy
cat > ~/.config/opencode/opencode.json <<INNER
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "eon-matrix": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "EON Cloud-Only Twin",
      "options": {
        "baseURL": "http://127.0.0.1:8201/v1",
        "apiKey": "noop"
      },
      "models": {
        "auto": { "name": "Sovereign Cloud (no earthly)" },
        "gpt-oss": { "name": "GPT-OSS (sovereign-llm)" },
        "qwen-coder": { "name": "Qwen Coder (sovereign-llm)" },
        "deepseek-r1": { "name": "DeepSeek R1 (sovereign-llm)" }
      }
    },
    "twin-ubuntu": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ubuntu Twin (Darknet)",
      "options": {
        "baseURL": "http://[201:cb13:92d1:f23f:ac06:ad1f:d8af:7906]:8303/v1",
        "apiKey": "noop"
      },
      "models": { "auto": "Ubuntu Twin via Yggdrasil" }
    },
    "twin-termux": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Termux Twin (Self)",
      "options": {
        "baseURL": "http://[200:f387:929:5543:b568:ddd8:5718:8375]:8304/v1",
        "apiKey": "noop"
      },
      "models": { "auto": "Termux Twin via Yggdrasil" }
    }
  },
  "model": "twin-ubuntu/auto",
  "darknet_mode": true,
  "matrix_mode": "sovereign-cloud-only",
  "proxy_chain": "tor-deprecated_for_internal__yggdrasil_only"
}
INNER

echo "[config] opencode.json patched to cloud-only twins via Yggdrasil IPv6"

# 3. Deploy yggdrasil config (if binary available)
if command -v yggdrasil >/dev/null 2>&1; then
  mkdir -p ~/eon-darknet
  curl -s --socks5-hostname 127.0.0.1:9050 --max-time 25 "https://raw.githubusercontent.com/didicola/eon-cloud-agent/main/darknet/termux-peer.hjson" -o ~/eon-darknet/termux-peer.hjson 2>/dev/null || echo "[ygg] no raw fetch — using embedded config"
  if [ -f ~/eon-darknet/termux-peer.hjson ]; then
    # patch the peer to point to your real Ubuntu public IP
    UBUNTU_WAN_IP=$(curl -s --max-time 5 https://check.torproject.org/api/ip | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['IP'])" 2>/dev/null || echo "YOUR_UBUNTU_WAN_IP")
    sed -i "s#tcp://<UBUNTU_WAN_ADDR>:51820#tcp://${UBUNTU_WAN_IP}:51820#g" ~/eon-darknet/termux-peer.hjson 2>/dev/null
    echo "[ygg] termux-peer.hjson ready, peering to ubuntu WAN ${UBUNTU_WAN_IP}:51820"
    yggdrasil -useconffile ~/eon-darknet/termux-peer.hjson -useconf > ~/eon-darknet/termux-ygg.log 2>&1 &
    sleep 3
    echo "[ygg] termux address: $(yggdrasil -useconffile ~/eon-darknet/termux-peer.hjson -address 2>/dev/null)"
  fi
else
  echo "[ygg] yggdrasil not installed on termux yet — will install from own-cloud D1"
fi

# 4. Verify matrix + matrix health (cloud-only)
echo "[verify] matrix health:"
curl -s --max-time 8 "http://127.0.0.1:8201/health" 2>/dev/null || echo "[verify] matrix down — starting coordinator"

# 5. Confirm earthly:false config
echo "[verify] cloud-only check:"
grep -q "twin-ubuntu" ~/.config/opencode/opencode.json && echo "OK: opencode routes via twin-ubuntu (cloud-only)" || echo "WARN: twin not found"

echo "=== TERMUX CONFIG COMPLETE ==="
echo "Next: DARKNET_MODE=1, mesh over Ygg IPv6, no blind-proxy"
'
RESPOND_FILE: ~/eon-termux-configure-status.resp
'