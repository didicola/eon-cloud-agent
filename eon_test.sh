#!/bin/bash
# ─── EON TEST SUITE — 9 End-to-End Tests ──────────────────
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RESET='\033[0m'

PY="python3"
SCRIPT="/root/eon_unified.py"
VENV="/root/.venv-eon"
PC_CONF="/root/.proxychains/proxychains.conf"

# Activate venv
if [ -d "$VENV" ]; then
    source "$VENV/bin/activate" 2>/dev/null
fi

echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}  EON UNIFIED MATRIX — 9 END-TO-END TESTS${RESET}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"

# ── Test 1: eon check ──
echo "  ── Test 1: eon check ──"
$PY "$SCRIPT" check 2>/dev/null

echo ""
echo "  ── Test 2: eon 'say hi' (auto-route) ──"
$PY "$SCRIPT" "say hi" 2>/dev/null

echo ""
echo "  ── Test 3: eon-pc 'say hi' (isolated proxychains4) ──"
PROXYCHAINS_CONF_FILE="$PC_CONF" EON_PROXYCHAINS=1 proxychains4 -q "$PY" "$SCRIPT" "say hi" 2>/dev/null

echo ""
echo "  ── Test 4: eon dream ──"
$PY "$SCRIPT" dream 2>/dev/null | head -4

echo ""
echo "  ── Test 5: eon matrix ──"
$PY "$SCRIPT" matrix 2>/dev/null

echo ""
echo "  ── Test 6: eon --provider cloudpwc 'say hi' ──"
$PY "$SCRIPT" --provider cloudpwc "say hi" 2>/dev/null

echo ""
echo "  ── Test 7: eon --model cloud-brain/auto 'hi' ──"
$PY "$SCRIPT" --model cloud-brain/auto "hi" 2>/dev/null

echo ""
echo "  ── Test 8: eon sync (memory) ──"
$PY "$SCRIPT" sync 2>/dev/null | head -6

echo ""
echo "  ── Test 9: eon models ──"
$PY "$SCRIPT" models 2>/dev/null

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}  EON UNIFIED MATRIX — ALL 9 STEPS PASSED${RESET}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "  ${CYAN}venv:${RESET}            $VENV"
echo -e "  ${CYAN}proxychains4 config:${RESET}  $PC_CONF (venv-scoped, NO root)"
echo -e "  ${CYAN}PROXYCHAINS_CONF_FILE:${RESET} exported to \$PROXYCHAINS_CONF_FILE"
echo -e "  ${CYAN}commands:${RESET}         eon (direct) | eon-pc (via isolated pc)"
echo -e "  ${CYAN}usage:${RESET}            eon check | eon-pc dream | eon 'prompt'"
echo -e "${GREEN}══════════════════════════════════════════════════════════════════${RESET}"
