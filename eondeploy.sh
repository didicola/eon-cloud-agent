#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# eondeploy — EON's wrangler alternative
# Deploy Workers to Cloudflare API OR local runtime
# Usage: eondeploy <command> [options]
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

EON_ROOT="/mnt/fluid-cloud/cloud-opencode"
LOCAL_RUNTIME="http://127.0.0.1:8787"
CF_API="https://api.cloudflare.com/client/v4"
CF_ACCOUNT="8eacb8fd6130211d2e51f8dae2b03c75"
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'

usage() {
  cat <<EOF
${CYAN}eondeploy${NC} — EON Worker deploy tool (wrangler alternative)

${GREEN}COMMANDS${NC}
  deploy <file> --name <name> [options]
    Deploy a Worker. Uses CF API if CLOUDFLARE_API_TOKEN is set,
    otherwise deploys to local runtime (127.0.0.1:8787).
    Options:
      --name <n>       Worker name (required)
      --kv <b>=<id>    KV binding (name=id)
      --do <b>=<c>     DO binding (name=class)
      --local          Force local runtime
      --cf             Force Cloudflare API
      --compat <date>  Compatibility date (default: 2026-07-31)

  list          List deployed Workers
  delete <name> Delete a Worker
  logs          Show local runtime logs
  kv create <n> Create a KV namespace
  kv list       List KV namespaces
  routes        List local runtime routes
  start         Start local runtime server
  stop          Stop local runtime server
  version       Show version

${CYAN}EXAMPLES${NC}
  eondeploy deploy ./worker.js --name my-worker --kv MY_KV=abc123
  eondeploy deploy ./worker.js --name local-test --local
  eondeploy kv create my-kv
  eondeploy start
EOF
}

# ─── Config ───────────────────────────────────────────────────
WORKER_NAME=""; WORKER_FILE=""; COMPAT_DATE="2026-07-31"
KV_BINDINGS=(); DO_BINDINGS=(); LOCAL=false; CF=false

parse_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) WORKER_NAME="$2"; shift 2 ;;
      --kv) KV_BINDINGS+=("$2"); shift 2 ;;
      --do) DO_BINDINGS+=("$2"); shift 2 ;;
      --compat) COMPAT_DATE="$2"; shift 2 ;;
      --local) LOCAL=true; shift ;;
      --cf) CF=true; shift ;;
      --) shift; break ;;
      *) break ;;
    esac
  done
}

# ─── Cloudflare API Helpers ──────────────────────────────────
cf_curl() {
  local method="$1"; shift
  local endpoint="$1"; shift
  local data="${1:-}"
  local ct="${2:-application/json}"
  [ -z "$CLOUDFLARE_API_TOKEN" ] && { echo -e "${RED}ERROR: CLOUDFLARE_API_TOKEN not set${NC}" >&2; return 1; }
  if [ -n "$data" ]; then
    curl -s -X "$method" "$CF_API$endpoint" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: $ct" "$@"
  else
    curl -s -X "$method" "$CF_API$endpoint" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" "$@"
  fi
}

# ─── Deploy ───────────────────────────────────────────────────
cmd_deploy() {
  local file="$1"; shift
  parse_flags "$@"
  [ -z "$WORKER_NAME" ] && { echo -e "${RED}ERROR: --name required${NC}" >&2; exit 1; }
  [ ! -f "$file" ] && { echo -e "${RED}ERROR: file not found: $file${NC}" >&2; exit 1; }

  # Auto-detect: CF if token set, else local
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ "$LOCAL" = false ]; then
    if [ "$CF" = false ] && [ "${1:-}" != "--local" ]; then
      CF=true
    fi
  fi

  if [ "$CF" = true ]; then
    cmd_deploy_cf "$file"
  else
    cmd_deploy_local "$file"
  fi
}

cmd_deploy_cf() {
  local file="$1"
  echo -e "${CYAN}[eondeploy]${NC} Deploying to Cloudflare: $WORKER_NAME"

  # Build metadata JSON
  local kv_json="[]"; local do_json="[]"
  if [ ${#KV_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${KV_BINDINGS[@]}"; do
      local name="${b%%=*}"
      local id="${b#*=}"
      items+="{\"name\":\"$name\",\"type\":\"kv_namespace\",\"namespace_id\":\"$id\"},"
    done
    items="${items%,}"
    kv_json="[$items]"
  fi
  if [ ${#DO_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${DO_BINDINGS[@]}"; do
      local name="${b%%=*}"
      local cls="${b#*=}"
      items+="{\"name\":\"$name\",\"type\":\"durable_object\",\"class_name\":\"$cls\"},"
    done
    items="${items%,}"
    do_json="[$items]"
  fi

  # Upload via CF API
  local script=$(cat "$file")
  local metadata=$(cat <<METADATA
{"body_part":"script","bindings":$(echo "$kv_json $do_json" | jq -s 'add')}
METADATA
)

  # Multipart upload
  local boundary="----eondeploy-$(date +%s)"
  local body
  body="--$boundary\r\n"
  body+="Content-Disposition: form-data; name=\"metadata\"\r\n"
  body+="Content-Type: application/json\r\n\r\n"
  body+="$metadata\r\n"
  body+="--$boundary\r\n"
  body+="Content-Disposition: form-data; name=\"script\"; filename=\"worker.js\"\r\n"
  body+="Content-Type: application/javascript+module\r\n\r\n"
  body+="$script\r\n"
  body+="--$boundary--\r\n"

  local resp
  resp=$(curl -s -X PUT "$CF_API/accounts/$CF_ACCOUNT/workers/scripts/$WORKER_NAME" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: multipart/form-data; boundary=$boundary" \
    --data-binary "$(echo -e "$body")")

  if echo "$resp" | python3 -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if d.get('success') else 1)" 2>/dev/null; then
    local url=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('result',{}).get('url',''))" 2>/dev/null)
    echo -e "${GREEN}✓${NC} Deployed $WORKER_NAME → $url"
    return 0
  else
    local err=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('errors',[{}])[0].get('message','unknown'))" 2>/dev/null)
    echo -e "${RED}✗${NC} Deploy failed: $err"
    return 1
  fi
}

cmd_deploy_local() {
  local file="$1"
  echo -e "${CYAN}[eondeploy]${NC} Deploying to local runtime: $WORKER_NAME"

  local target="$EON_ROOT/workers/$WORKER_NAME"
  mkdir -p "$target"
  cp "$file" "$target/worker.js"

  # Save metadata
  cat > "$target/meta.json" <<META
{
  "name": "$WORKER_NAME",
  "compat_date": "$COMPAT_DATE",
  "kv_bindings": [$(for b in "${KV_BINDINGS[@]}"; do echo "\"$b\","; done | sed 's/,$//')],
  "do_bindings": [$(for b in "${DO_BINDINGS[@]}"; do echo "\"$b\","; done | sed 's/,$//')],
  "deployed_at": $(date +%s)
}
META

  # Register with local runtime
  curl -s -X POST "$LOCAL_RUNTIME/__deploy" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$WORKER_NAME\"}" > /dev/null 2>&1 && \
    echo -e "${GREEN}✓${NC} Deployed $WORKER_NAME locally" || \
    echo -e "${YELLOW}⚠${NC} Local runtime not running — saved to $target"
}

# ─── List ─────────────────────────────────────────────────────
cmd_list() {
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo -e "${CYAN}Cloudflare Workers:${NC}"
    cf_curl GET "/accounts/$CF_ACCOUNT/workers/scripts" | \
      python3 -c "import sys,json;d=json.load(sys.stdin);[print(f'  {s[\"id\"]}') for s in d.get('result',[])]" 2>/dev/null || \
      echo "  (none or API error)"
  fi

  echo -e "${CYAN}Local Workers:${NC}"
  if [ -d "$EON_ROOT/workers" ]; then
    for d in "$EON_ROOT/workers"/*/; do
      local name=$(basename "$d")
      [ -f "$d/worker.js" ] && echo "  $name"
      [ -f "$d/meta.json" ] && python3 -c "import json;m=json.load(open('$d/meta.json'));print(f'    kv:{len(m[\"kv_bindings\"])} do:{len(m[\"do_bindings\"])}')" 2>/dev/null
    done
  fi
}

# ─── Delete ───────────────────────────────────────────────────
cmd_delete() {
  local name="$1"
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo -e "${CYAN}[eondeploy]${NC} Deleting from Cloudflare: $name"
    cf_curl DELETE "/accounts/$CF_ACCOUNT/workers/scripts/$name" | \
      python3 -c "import sys,json;d=json.load(sys.stdin);print(f'{\"✓\" if d.get(\"success\") else \"✗\"} {d.get(\"errors\",[{}])[0].get(\"message\",\"deleted\")}')"
  fi
  rm -rf "$EON_ROOT/workers/$name" 2>/dev/null && \
    echo -e "${GREEN}✓${NC} Deleted local: $name" || true
}

# ─── KV ───────────────────────────────────────────────────────
cmd_kv() {
  local action="$1"; shift
  case "$action" in
    create)
      local name="$1"
      if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
        local resp=$(cf_curl POST "/accounts/$CF_ACCOUNT/storage/kv/namespaces" \
          "{\"title\":\"$name\"}")
        echo "$resp" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'KV: {d[\"result\"][\"id\"]}')" 2>/dev/null || \
          echo -e "${RED}✗${NC} Create failed"
      else
        mkdir -p "$EON_ROOT/kv/$name"
        echo -e "${GREEN}✓${NC} Local KV: $EON_ROOT/kv/$name"
      fi
      ;;
    list)
      if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
        cf_curl GET "/accounts/$CF_ACCOUNT/storage/kv/namespaces" | \
          python3 -c "import sys,json;[print(f'  {n[\"title\"]} ({n[\"id\"]})') for n in json.load(sys.stdin).get('result',[])]" 2>/dev/null || true
      fi
      ls "$EON_ROOT/kv" 2>/dev/null | while read d; do echo "  $d (local)"; done
      ;;
    *)
      echo "Usage: eondeploy kv {create|list} [name]"
      ;;
  esac
}

# ─── Local Runtime Management ─────────────────────────────────
cmd_start() {
  local port="${1:-8787}"
  local https=""
  case "$2" in
    --https|https) https="--https" ;;
  esac
  if [ -f /tmp/eon_runtime.pid ]; then
    local pid=$(cat /tmp/eon_runtime.pid)
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${GREEN}✓${NC} Runtime already running (PID $pid)"
      return 0
    fi
  fi
  nohup node "$EON_ROOT/eon_runtime.mjs" --port "$port" $https > /tmp/eon_runtime.log 2>&1 &
  local pid=$!
  echo "$pid" > /tmp/eon_runtime.pid
  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Runtime started (PID $pid) on port $port${https:+ + 80/443}"
    if [ -n "$https" ]; then
      if curl -sk -o /dev/null -w "%{http_code}" "https://localhost/v3" 2>/dev/null | grep -q "200"; then
        echo -e "${GREEN}✓${NC} HTTPS :443 serving (self-signed)"
      fi
      if curl -s -o /dev/null -w "%{http_code}" "http://localhost/v3" 2>/dev/null | grep -q "301"; then
        echo -e "${GREEN}✓${NC} HTTP :80 → redirect to HTTPS"
      fi
    fi
  else
    echo -e "${RED}✗${NC} Runtime failed to start"
    cat /tmp/eon_runtime.log
  fi
}

cmd_stop() {
  if [ -f /tmp/eon_runtime.pid ]; then
    local pid=$(cat /tmp/eon_runtime.pid)
    kill "$pid" 2>/dev/null && echo -e "${GREEN}✓${NC} Runtime stopped" || true
    rm -f /tmp/eon_runtime.pid
  fi
}

cmd_logs() {
  tail -f /tmp/eon_runtime.log 2>/dev/null || echo "No logs"
}

# ─── Main ─────────────────────────────────────────────────────
case "${1:-help}" in
  deploy)
    shift; cmd_deploy "$@"
    ;;
  list|ls)
    cmd_list
    ;;
  delete|rm)
    shift; cmd_delete "$@"
    ;;
  kv)
    shift; cmd_kv "$@"
    ;;
  start)
    shift; cmd_start "$@"
    ;;
  stop)
    cmd_stop
    ;;
  logs)
    cmd_logs
    ;;
  routes)
    curl -s "$LOCAL_RUNTIME/__routes" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Runtime not running"
    ;;
  version|--version|-v)
    echo "eondeploy v3.0.0 — EON Worker deploy tool"
    echo "Runtime: Cloudflare API + local (127.0.0.1:8787)"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}"
    usage
    exit 1
    ;;
esac
