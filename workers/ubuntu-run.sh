#!/bin/bash
# ubuntu-run.sh — run a command on the twin Ubuntu's terminal via the sovereign
# p2p delegate lane (no earthly broker, no SSH). Thin wrapper over ubuntu_terminal.py.
#   bash workers/ubuntu-run.sh "hostname && whoami"
#   bash workers/ubuntu-run.sh --probe          # confirm the terminal lane is live
#   bash workers/ubuntu-run.sh --list           # ubuntu tasks still pending
#   bash workers/ubuntu-run.sh --tail           # recent dispatches we sent
cd "$(dirname "$0")/.." || exit 1
export EON_ACCESS_TOKEN="$(grep -oP 'EON_ACCESS_TOKEN=\K.*' state/.mesh-token.env 2>/dev/null || true)"
exec python3 workers/ubuntu_terminal.py "$@"
