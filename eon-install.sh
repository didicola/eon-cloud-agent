#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# eon-install.sh — bootstrap the EON sovereign arch on a fresh Ubuntu box
# Run as the deploying user:  bash eon-install.sh [install-dir]
# Default install dir: ~/eon-cloud-agent
# Zero earthly deps: needs only Node 20+, Python 3.11+, tor.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="${1:-$HOME/eon-cloud-agent}"
PKG_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$(mktemp /tmp/eon-install-XXXX.log)"
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
say() { echo -e "${CYAN}[eon-install]${NC} $1"; }
warn() { echo -e "${RED}[eon-install]${NC} $1"; }
ok()   { echo -e "${GREEN}[eon-install]${NC} $1"; }

say "EON sovereign arch installer"
say "  package dir : $PKG_DIR"
say "  install dir : $INSTALL_DIR"
say "  log         : $LOG"

# ── 0. requirements ──
need() { command -v "$1" >/dev/null 2>&1 || { warn "missing $1 -> $2"; return 1; }; }
MISSING=0
need node "sudo apt-get install -y nodejs" || MISSING=1
need python3 "sudo apt-get install -y python3 python3-venv" || MISSING=1
need tor "sudo apt-get install -y tor" || MISSING=1
if [ "$MISSING" = "1" ]; then
  warn "install missing packages first, then re-run."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then warn "node >=18 recommended (have $NODE_MAJOR)"; fi
ok "requirements present (node $NODE_MAJOR)"

# ── 1. copy package ──
mkdir -p "$INSTALL_DIR"
say "copying files..."
# copy everything except git internals, the old venv, and runtime state
( cd "$PKG_DIR" && tar cf - \
    --exclude=.git --exclude=venv --exclude=state --exclude='__pycache__' \
    --exclude='*.pyc' . ) | ( cd "$INSTALL_DIR" && tar xf - )
ok "files copied -> $INSTALL_DIR"

# ── 2. adapt hardcoded paths ──
# The arch hardcodes /root/eon-cloud-agent (venv, state, workers, physics DBs,
# supervisor, memory files). Replace the base globally across every text file.
# (venv-run.sh's VENV_PY and the per-file absolute paths all fall under this.)
OLD_BASE="/root/eon-cloud-agent"
CHANGED=0
while IFS= read -r -d '' f; do
  sed -i "s#$OLD_BASE#$INSTALL_DIR#g" "$f"
  CHANGED=$((CHANGED+1))
done < <(grep -rlFZ "$OLD_BASE" "$INSTALL_DIR" 2>/dev/null || true)
# also fix the venv-run.sh VENV_PY line in case it didn't contain the old base verbatim
sed -i "s#VENV_PY=\"[^\"]*\"#VENV_PY=\"$INSTALL_DIR/venv/bin/python\"#" "$INSTALL_DIR/venv-run.sh"
ok "paths adapted ($CHANGED files rewritten to $INSTALL_DIR)"

# ── 3. python venv (stdlib-only, no pip deps needed) ──
say "creating python venv at $INSTALL_DIR/venv ..."
python3 -m venv "$INSTALL_DIR/venv"
ok "venv ready"

# ── 4. local state dir + fresh access token ──
mkdir -p "$INSTALL_DIR/state"
if [ ! -f "$INSTALL_DIR/state/.mesh-token.env" ]; then
  TOK="eon-$(head -c 16 /dev/urandom | xxd -p)"
  printf 'EON_ACCESS_TOKEN=%s\n' "$TOK" > "$INSTALL_DIR/state/.mesh-token.env"
  chmod 600 "$INSTALL_DIR/state/.mesh-token.env"
  ok "fresh mesh access token generated (see state/.mesh-token.env)"
fi
mkdir -p "$INSTALL_DIR/state/models"

# ── 5. tor (onion door) ──
if [ ! -f /tmp/tor-min.conf ]; then
  cp "$INSTALL_DIR/workers/tor-min.conf" /tmp/tor-min.conf 2>/dev/null || true
fi
say "starting tor ..."
setsid nohup tor -f /tmp/tor-min.conf >> /tmp/tor.log 2>&1 </dev/null & disown
sleep 10
HS="$(find /tmp/tor-hs -name hostname 2>/dev/null | head -1)"
if [ -n "$HS" ]; then ok "onion: $(cat "$HS")"; else warn "tor still bootstrapping (check /tmp/tor.log)"; fi

# ── 6. boot the stack ──
say "booting the full EON stack (18 services)..."
cd "$INSTALL_DIR"
bash workers/boot_stack.sh 2>&1 | tail -5 || true
sleep 3

# ── 7. health checks ──
say "health checks..."
for p in 8787 8201; do
  RC=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$p/" 2>/dev/null || echo 000)
  echo "  :$p -> $RC"
done
TOK="$(grep -oP 'EON_ACCESS_TOKEN=\K.*' "$INSTALL_DIR/state/.mesh-token.env" 2>/dev/null || true)"
echo "  mesh token: ${TOK:0:8}..."

ok "EON installed at $INSTALL_DIR"
say "next steps:"
echo "  1. export EON_ACCESS_TOKEN=\$(grep -oP 'EON_ACCESS_TOKEN=\\K.*' $INSTALL_DIR/state/.mesh-token.env)"
echo "  2. test the gate:  curl -X POST http://127.0.0.1:8787/api/ml/run -H 'Content-Type: application/json' -H \"Authorization: Bearer \$EON_ACCESS_TOKEN\" -d '{\"code\":\"x=1\"}'"
echo "  3. this box's onion: $(cat "$HS" 2>/dev/null || echo '(see /tmp/tor-hs/*/hostname)')"
say "done. log: $LOG"
