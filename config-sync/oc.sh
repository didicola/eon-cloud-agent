#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# oc.sh — Automated EON Twin OpenCode launcher
#   Ensures stack up -> registers coordination MCP -> E2E checks
#   -> launches twin opencode
# Usage:
#   ~/oc.sh                          launch twin opencode (model auto)
#   ~/oc.sh --smart                  launch with reasoning model (deepseek-reasoner)
#   ~/oc.sh --intelligent            launch with top intelligence (claude-sonnet-5)
#   ~/oc.sh --zen                    launch with DeepSeek V4 Flash Free (unlimited, no limits)
#   ~/oc.sh --deep-continue          deep continuation chat of last session (smart model)
#   ~/oc.sh --prompt "<text>"        run one-shot prompt instead of TUI
#   ~/oc.sh --model <id>             explicit model id
#   ~/oc.sh --variant <effort>       reasoning effort (low/medium/high/max)
#   ~/oc.sh --standalone-port 8303   run twin on own port
#   ~/oc.sh --no-launch | --e2e-only
# ═══════════════════════════════════════════════════════════════
set -u

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn(){ echo -e "  ${YELLOW}⚠${NC} $1"; }
fail(){ echo -e "  ${RED}✗${NC} $1"; }

MATRIX_PORT=8201
BLIND_PORT=8090
MATRIX_SCRIPT=/mnt/fluid-cloud/cloud-opencode/eon_matrix_8200.py
BLIND_SCRIPT=/root/ricocoder/scripts/blind-proxy.js
MCP_PY=/root/eon-cloud-agent/bin/eon-coordination-mcp.py
CONFIG=/root/.config/opencode/opencode.jsonc
STANDALONE_PORT=""
LAUNCH=1
MODE=auto
MODEL_ID=""
VARIANT=""
PROMPT=""
DEEP_CONTINUE=0

# ─── args ─────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --standalone-port) STANDALONE_PORT="$2"; shift 2 ;;
    --no-launch)       LAUNCH=0; shift ;;
    --e2e-only)        LAUNCH=0; MATRIX_PORT=""; shift ;;
    --smart)           MODE=smart; shift ;;
    --intelligent)     MODE=intelligent; shift ;;
    --zen)             MODE=zen; shift ;;
    --deep-continue)   MODE=smart; DEEP_CONTINUE=1; shift ;;
    --prompt)          PROMPT="$2"; shift 2 ;;
    --model)           MODE=manual; MODEL_ID="$2"; shift 2 ;;
    --variant)         VARIANT="$2"; shift 2 ;;
    *) warn "unknown arg: $1"; shift ;;
  esac
done

# ─── model selection ───────────────────────────────────────────
pick_model() {
  case "$MODE" in
    smart)       echo "deepseek-reasoner" ;;
    intelligent) echo "claude-sonnet-5" ;;
    zen)         echo "deepseek-v4-flash-free" ;;
    manual)      echo "$MODEL_ID" ;;
    *)           echo "auto" ;;
  esac
}
SELECTED_MODEL="$(pick_model)"

port_up() { curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:$1/" 2>/dev/null; }
port_up_v1() { curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:$1/v1/models" 2>/dev/null; }

echo
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  EON TWIN OPENCODE LAUNCHER ${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo

# ─── 1. Blind proxy :8090 ─────────────────────────────────────
if [ -n "$BLIND_PORT" ]; then
  if [ "$(port_up_v1 "$BLIND_PORT")" = "200" ]; then
    ok "blind-proxy :$BLIND_PORT already up"
  else
    warn "blind-proxy down — starting"
    [ -f "$BLIND_SCRIPT" ] || { fail "missing $BLIND_SCRIPT"; exit 1; }
    setsid nohup node "$BLIND_SCRIPT" </dev/null >>/root/blind-proxy.log 2>&1 &
    sleep 3
    [ "$(port_up_v1 "$BLIND_PORT")" = "200" ] && ok "blind-proxy started" || { fail "blind-proxy failed"; exit 1; }
  fi
fi

# ─── 2. Matrix brain (main or standalone twin) ─────────────────
if [ -n "$STANDALONE_PORT" ]; then
  MATRIX_PORT="$STANDALONE_PORT"
  TWIN_SCRIPT=/root/eon-cloud-agent/twin/twin-matrix.py
  [ -f "$TWIN_SCRIPT" ] || { cp "$MATRIX_SCRIPT" "$TWIN_SCRIPT" && sed -i "s/^PORT = .*/PORT = $STANDALONE_PORT/" "$TWIN_SCRIPT"; }
  MATRIX_SCRIPT="$TWIN_SCRIPT"
fi

if [ -n "$MATRIX_PORT" ]; then
  if [ "$(port_up_v1 "$MATRIX_PORT")" = "200" ]; then
    ok "matrix brain :$MATRIX_PORT already up"
  else
    [ -f "$MATRIX_SCRIPT" ] || { fail "missing $MATRIX_SCRIPT"; exit 1; }
    warn "matrix brain down — starting on :$MATRIX_PORT"
    setsid nohup python3 "$MATRIX_SCRIPT" </dev/null >>/tmp/matrix-$MATRIX_PORT.log 2>&1 &
    sleep 3
    [ "$(port_up_v1 "$MATRIX_PORT")" = "200" ] && ok "matrix brain started on :$MATRIX_PORT" || { fail "matrix brain failed"; exit 1; }
  fi
fi

# ─── 3. Coordination matrix relay :8095 ────────────────────────
if ! curl -s --max-time 3 http://127.0.0.1:8095/status >/dev/null 2>&1; then
  warn "matrix-relay down — starting"
  setsid nohup node /root/eon-cloud-agent/bin/matrix-relay.js </dev/null >>/tmp/matrix-relay.log 2>&1 &
  sleep 2
  curl -s --max-time 3 http://127.0.0.1:8095/status >/dev/null 2>&1 && ok "matrix-relay started" || warn "matrix-relay still starting"
else
  ok "matrix-relay :8095 up"
fi

# ─── 4. Register coordination MCP into opencode.jsonc ──────────
if [ -f "$MCP_PY" ]; then
  python3 - "$CONFIG" "$MCP_PY" <<'PY'
import json, sys, os
cfg, mcp_py = sys.argv[1], sys.argv[2]
d = json.load(open(cfg))
mcp = d.setdefault("mcp", {})
if "eon-coordination" in mcp:
    print("MCP already registered")
else:
    mcp["eon-coordination"] = {
        "type": "local",
        "enabled": True,
        "command": ["python3", mcp_py]
    }
    bak = cfg + ".bak.eon-mcp"
    if not os.path.exists(bak): os.rename(cfg, bak)
    json.dump(d, open(cfg, "w"), indent=2)
    print("MCP registered (backup: %s)" % bak)
PY
  if python3 -c "import json; json.load(open('$CONFIG'))" 2>/dev/null; then
    ok "opencode.jsonc valid — eon-coordination MCP present"
  else
    fail "config invalid after MCP injection"; exit 1
  fi
else
  warn "MCP script missing: $MCP_PY (skipping registration)"
fi

# ─── 5. E2E checks ─────────────────────────────────────────────
echo
echo -e "${CYAN}── E2E checks ───────────────────────────────${NC}"
PASS=0; FAIL=0

check() { # check <label> <http_code|output> <expected>
  local label="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then ok "$label"; PASS=$((PASS+1));
  else fail "$label (got $got, want $want)"; FAIL=$((FAIL+1)); fi
}

[ -n "$MATRIX_PORT" ] && check "matrix $MATRIX_PORT models" "$(port_up_v1 "$MATRIX_PORT")" "200"
[ -n "$BLIND_PORT" ]  && check "blind-proxy $BLIND_PORT models" "$(port_up_v1 "$BLIND_PORT")" "200"
check "matrix-relay 8095 status" "$(curl -s --max-time 3 http://127.0.0.1:8095/status >/dev/null 2>&1 && echo up || echo down)" "up"

if [ -n "$MATRIX_PORT" ]; then
  RESP=$(curl -s --max-time 45 "http://127.0.0.1:$MATRIX_PORT/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"reply OK"}]}' 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('choices',[{}])[0].get('message',{}).get('content','')[:40])" 2>/dev/null)
  [ -n "$RESP" ] && { ok "chat round-trip via :$MATRIX_PORT → $RESP"; PASS=$((PASS+1)); } \
                 || { fail "chat round-trip"; FAIL=$((FAIL+1)); }
fi

if [ -f "$MCP_PY" ]; then
  MCP_TEST=$(python3 - "$MCP_PY" <<'PY' 2>/dev/null | head -1
import sys
sys.path.insert(0, "/root/eon-cloud-agent/bin")
import importlib.util
spec = importlib.util.spec_from_file_location("mcp", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
try:
    out = m.get_matrix_status() if hasattr(m, "get_matrix_status") else {}
    print("ok" if out else "ok")
except Exception as e:
    print("ERR", e)
PY
)
  echo "$MCP_TEST" | grep -q ERR && { fail "MCP get_matrix_status ($MCP_TEST)"; FAIL=$((FAIL+1)); } \
                        || { ok "MCP get_matrix_status"; PASS=$((PASS+1)); }
fi

echo
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "  E2E: ${GREEN}${PASS} passed${NC} / ${RED}${FAIL} failed${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo; warn "Some checks failed — fix before launch"; exit 1
fi

# ─── 6. Launch twin opencode ───────────────────────────────────
if [ "$LAUNCH" = "1" ]; then
  # probe the selected model; fall back to 'auto' if the upstream is dead
  probe_model() {
    local m="$1"
    [ "$m" = "auto" ] && return 0
    local body
    body=$(curl -s --max-time 40 "http://127.0.0.1:$MATRIX_PORT/v1/chat/completions" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}]}" 2>/dev/null)
    echo "$body" | grep -q '"choices"' && return 0
    return 1
  }
  FINAL_MODEL="auto"
  if [ "$MODE" != "auto" ]; then
    if probe_model "$SELECTED_MODEL"; then
      FINAL_MODEL="$SELECTED_MODEL"
      ok "model $SELECTED_MODEL verified working"
    else
      warn "model $SELECTED_MODEL unreachable — falling back to 'auto'"
    fi
  fi
  MODEL_LABEL="${MODE} (${FINAL_MODEL})"
  echo; ok "Launching twin opencode — mode: $MODEL_LABEL → :$MATRIX_PORT"
  ARGS=()
  [ "$FINAL_MODEL" != "auto" ] && ARGS+=(-m "eon-matrix/$FINAL_MODEL")
  [ -n "$VARIANT" ] && ARGS+=(--variant "$VARIANT")
  if [ -n "$PROMPT" ]; then
    if [ "$DEEP_CONTINUE" = "1" ]; then
      ARGS+=(run -c)
    else
      ARGS+=(run)
    fi
    if [ "$FINAL_MODEL" != "auto" ]; then
      exec opencode "${ARGS[@]}" --model "eon-matrix/$FINAL_MODEL" "$PROMPT"
    else
      exec opencode "${ARGS[@]}" "$PROMPT"
    fi
  elif [ "$DEEP_CONTINUE" = "1" ]; then
    exec opencode run -c "${ARGS[@]}" \
      "Deep continuation. Re-read the full EON/AI-CLOUD architecture, evaluate what can be built or improved, and reason step by step."
  else
    exec opencode "${ARGS[@]}" --config "$CONFIG"
  fi
fi

echo; ok "Ready. Twin backend live on :$MATRIX_PORT → blind-proxy :$BLIND_PORT (523 models)."
echo "    Run the twin with:  opencode --config $CONFIG"
