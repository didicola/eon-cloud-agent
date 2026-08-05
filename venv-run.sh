#!/bin/bash
# venv-run.sh — canonical no-hang launch for EON python services.
# Runs a python script under the virtual environment, FULLY detached:
#   new session (setsid) + stdin from /dev/null + stdout/stderr to log + disowned.
# Because the child runs under venv/bin/python and inherits NO caller fd, the
# invoking shell can never hang on a leaked pipe (the inherited-fd root cause).
# Also exports EON_ACCESS_TOKEN from state/.mesh-token.env if the caller didn't,
# so every python service authenticates against the token-gated mesh.
# Usage: venv-run.sh <script.py> [logfile]
set -e
SCRIPT="$1"
LOGFILE="${2:-/tmp/service.log}"
[ -n "$SCRIPT" ] || { echo "usage: $0 <script.py> [logfile]"; exit 1; }
VENV_PY="/root/eon-cloud-agent/venv/bin/python"
[ -x "$VENV_PY" ] || { echo "venv python missing: $VENV_PY"; exit 1; }
if [ -z "$EON_ACCESS_TOKEN" ] && [ -f /root/eon-cloud-agent/state/.mesh-token.env ]; then
  export EON_ACCESS_TOKEN="$(grep -oP 'EON_ACCESS_TOKEN=\K.*' /root/eon-cloud-agent/state/.mesh-token.env 2>/dev/null || true)"
fi
setsid nohup "$VENV_PY" -u "$SCRIPT" >>"$LOGFILE" 2>&1 </dev/null &
disown
echo "launched venv python: $SCRIPT -> $LOGFILE"
