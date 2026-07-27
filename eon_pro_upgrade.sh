#!/bin/bash
set -e

MACHINE=$(hostname)
USER=$(whoami)
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     EON PRO INTELLIGENCE DEVICE UPGRADE                     ║"
echo "║     Machine: $MACHINE"
echo "║     User: $USER"
echo "╚═══════════════════════════════════════════════════════════════╝"

# 1. Update EON Mega Brain to latest
echo "[1/8] Updating EON Mega Brain..."
cd ~/eon-cloud-agent 2>/dev/null && git pull origin main --rebase
cp eon_mega_brain.py /usr/local/bin/eon 2>/dev/null
chmod +x /usr/local/bin/eon

# 2. Install Matrix Intelligence
echo "[2/8] Installing Matrix Intelligence..."
cp eon_matrix_intelligence.py /root/eon_matrix_intelligence.py 2>/dev/null
chmod +x /root/eon_matrix_intelligence.py

# 3. Install Permanent Channel
echo "[3/8] Installing Permanent Internal Channel..."
cp eon_channel.py /root/eon_channel.py
chmod +x /root/eon_channel.py

# 4. Install updated GitHub relay
echo "[4/8] Installing GitHub relay..."
cp eon_github_relay.py /root/eon_github_relay.py 2>/dev/null

# 5. Create Pro Intelligence config
echo "[5/8] Creating Pro Intelligence config..."
mkdir -p ~/eon-config
cat > ~/eon-config/pro-intelligence.json << 'CFG'
{
  "version": "4.0-pro-intelligence",
  "tier": "max",
  "intelligence_level": "pro",
  "billing": "free-forever",
  "features": {
    "matrix_intelligence": true,
    "permanent_channel": true,
    "x1000_replication": true,
    "neuroplasticity": true,
    "all_models_unlocked": true,
    "unlimited_requests": true,
    "p2p_mesh": true,
    "tor_anonymity": true,
    "self_healing": true,
    "auto_upgrade": true
  }
}
CFG
export EON_INTELLIGENCE=pro

# 6. Start permanent channel
echo "[6/8] Starting Permanent Channel..."
python3 /root/eon_channel.py start &
echo "Permanent channel PID: $!"

# 7. Start GitHub relay
echo "[7/8] Starting GitHub relay..."
EON_MACHINE_ID="$(hostname | cut -d. -f1)" nohup python3 /root/eon_github_relay.py listen > ~/eon-github-relay.log 2>&1 &
echo "GitHub relay PID: $!"

# 8. Register all services for auto-start
echo "[8/8] Registering auto-start..."
RC_FILE="$HOME/.bashrc"
if ! grep -q "EON_INTELLIGENCE" "$RC_FILE" 2>/dev/null; then
  cat >> "$RC_FILE" << 'RCEXPORT'
# EON Pro Intelligence - automatic startup
export EON_INTELLIGENCE=pro
export EON_TIER=pro-max
export PATH=$PATH:/usr/local/bin
# Start services if not already running
if ! pgrep -f eon_channel > /dev/null; then
  python3 /root/eon_channel.py start &
fi
RCEXPORT
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     EON PRO INTELLIGENCE DEVICE — UPGRADE COMPLETE          ║"
echo "║     Machine: $MACHINE upgraded to Pro Intelligence           ║"
echo "║     Channel: Permanent Internal (4 transports)              ║"
echo "║     Features: Matrix ×1000, Neuroplasticity, P2P Mesh       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Commands:"
echo "  eon --chat                 - Continuation chat (opens chat)"
echo "  eon_channel.py start       - Start permanent channel"
echo "  eon_channel.py send <msg>  - Send via best transport"
echo "  eon_channel.py route       - Channel architecture"
echo "  eon_matrix_intelligence.py think <q> - ×1000 thought"
