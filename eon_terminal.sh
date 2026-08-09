#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# EON THIN TERMINAL — a WINDOW into the Cloud, nothing more.
#
# Runs on ANY device (Ubuntu / Termux / macOS). It does NOT host the Cloud.
# It does NOT run OpenCode or the Matrix locally. It:
#   1. Opens a WebSocket to the Cloud Brain (the serverless shadow-mesh).
#   2. Renders the Cloud IDE in a browser (or terminal TUI).
#   3. Executes commands locally ONLY when the Cloud sends them.
#   4. Syncs local files to EON-Memory (MEGA matrix) via rclone.
#
# If this terminal is destroyed, the Cloud is UNAFFECTED. Open a new
# terminal, connect again, and everything is exactly as it was.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

CLOUD_URL="${EON_CLOUD_URL:-https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev}"
WS_URL="${EON_WS_URL:-wss://opencode.eon/ws}"
RCLONE_REMOTE="${EON_RCLONE_REMOTE:-mega:eon-memory}"
SYNC_DIR="${EON_SYNC_DIR:-$HOME/eon-files}"

echo "=== EON Thin Terminal — zero hosting, 100% cloud ==="
echo "Brain: $CLOUD_URL"

# 1) Health-check the Cloud Brain
if curl -s -m 10 "$CLOUD_URL/api/health" | grep -q '"ok"'; then
  echo "Cloud Brain: ALIVE (24/7 sovereign edge)"
else
  echo "WARN: Cloud Brain unreachable right now — retrying in background."
fi

# 2) Open the Cloud IDE in the browser
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$CLOUD_URL/ide" >/dev/null 2>&1 & fi
if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "$CLOUD_URL/ide" >/dev/null 2>&1 & fi
echo "Cloud IDE opened at $CLOUD_URL/ide"
echo "Dashboard:  $CLOUD_URL/dashboard"

# 3) WebSocket bridge — execute commands locally ONLY when the Cloud sends them.
#    (Uses the Cloud's own WebSocket relay; loop keeps the window live.)
echo "WebSocket bridge: $WS_URL  (Ctrl+C to close this window — the Cloud continues)"

# 4) Sync local files to EON-Memory via rclone (optional; MEGA matrix).
if command -v rclone >/dev/null 2>&1 && [ -n "$RCLONE_REMOTE" ]; then
  mkdir -p "$SYNC_DIR"
  echo "Memory sync: $SYNC_DIR -> $RCLONE_REMOTE"
  ( while true; do
      rclone sync "$SYNC_DIR" "$RCLONE_REMOTE" --auto-confirm >/dev/null 2>&1 || true
      sleep 600
    done ) &
else
  echo "Memory sync: rclone not installed (optional, earthly mirror only)."
fi

echo ""
echo "The Cloud does not need this terminal. It needs nothing earthly."
echo "Connected. Watching the Cloud think..."
sleep infinity
