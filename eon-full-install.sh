#!/bin/bash
# ─── EON FULL INSTALL FOR UBUNTU ───────────────────────────
# Run this on Ubuntu to set up the complete EON Unified Matrix
set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}  EON FULL INSTALL — UBUNTU UNIFIED MATRIX${RESET}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"

# 1. Pull latest code
echo -e "\n${CYAN}[1/8] Pulling latest code...${RESET}"
cd ~/eon-cloud-agent && git pull origin main

# 2. Create venv
echo -e "\n${CYAN}[2/8] Creating Python venv...${RESET}"
python3 -m venv ~/.venv-eon 2>/dev/null || echo "venv exists"
source ~/.venv-eon/bin/activate

# 3. Install dependencies
echo -e "\n${CYAN}[3/8] Installing dependencies...${RESET}"
pip install --quiet requests 2>/dev/null || true

# 4. Install eon commands
echo -e "\n${CYAN}[4/8] Installing eon commands...${RESET}"
cp ~/eon-cloud-agent/eon /usr/local/bin/eon
cp ~/eon-cloud-agent/eon-pc /usr/local/bin/eon-pc
cp ~/eon-cloud-agent/eon_unified.py ~/eon_unified.py
cp ~/eon-cloud-agent/eon_test.sh ~/eon_test.sh
chmod +x /usr/local/bin/eon /usr/local/bin/eon-pc ~/eon_unified.py ~/eon_test.sh

# 5. Create proxychains config
echo -e "\n${CYAN}[5/8] Creating proxychains config...${RESET}"
mkdir -p ~/.proxychains
cat > ~/.proxychains/proxychains.conf << 'PCEOF'
strict_chain
proxy_dns
tcp_read_time_out 15000
tcp_connect_time_out 8000

[ProxyList]
socks5 127.0.0.1 9050
PCEOF

# 6. Install matrix listener
echo -e "\n${CYAN}[6/8] Installing matrix listener...${RESET}"
cp ~/eon-cloud-agent/eon_matrix_router.py ~/ 2>/dev/null || true
cp ~/eon-cloud-agent/eon_matrix_listener.py ~/ 2>/dev/null || true
cp ~/eon-cloud-agent/eon_github_relay.py ~/ 2>/dev/null || true

# 7. Start services
echo -e "\n${CYAN}[7/8] Starting services...${RESET}"
# Start GitHub relay
EON_MACHINE_ID=ubuntu nohup python3 ~/eon_github_relay.py listen > ~/eon-github-relay.log 2>&1 &
echo "  GitHub relay PID: $!"

# Start matrix listener
EON_MACHINE_ID=ubuntu nohup python3 ~/eon_matrix_listener.py > ~/eon-matrix.log 2>&1 &
echo "  Matrix listener PID: $!"

# 8. Run tests
echo -e "\n${CYAN}[8/8] Running 9-step test suite...${RESET}"
cd ~
bash ~/eon-cloud-agent/eon_test.sh

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}  INSTALL COMPLETE — UBUNTU UNIFIED MATRIX READY${RESET}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "  ${CYAN}commands:${RESET}    eon (direct) | eon-pc (via tor)"
echo -e "  ${CYAN}usage:${RESET}       eon check | eon 'prompt' | eon dream"
echo -e "  ${CYAN}matrix:${RESET}      eon matrix | eon sync"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
