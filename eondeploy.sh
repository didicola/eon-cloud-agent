#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# eondeploy v4.0.0 — EON's wrangler alternative
# Deploy Workers to Cloudflare API OR local runtime
# Usage: eondeploy <command> [options]
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

EON_ROOT="/mnt/fluid-cloud/cloud-opencode"
LOCAL_RUNTIME="http://127.0.0.1:8787"
CF_API="https://api.cloudflare.com/client/v4"
CF_ACCOUNT="8eacb8fd6130211d2e51f8dae2b03c75"
TOKEN_FILE="/tmp/eon_runtime.token"
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'

api() {
  # api <method> <path> [data]
  local method="$1"; shift
  local path="$1"; shift
  local data="${1:-}"
  local args=(-s -X "$method" "$LOCAL_RUNTIME$path" -H "Content-Type: application/json")
  if [ -f "$TOKEN_FILE" ]; then
    args+=(-H "x-eon-token: $(cat "$TOKEN_FILE")")
  fi
  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi
  curl "${args[@]}"
}

usage() {
  cat <<EOF
${CYAN}eondeploy v4.0.0${NC} — EON Worker deploy tool (wrangler alternative)

${GREEN}COMMANDS${NC}
  deploy <file> --name <name> [options]
    Deploy a Worker. Uses CF API if CLOUDFLARE_API_TOKEN is set,
    otherwise deploys to local runtime (127.0.0.1:8787).
    Options:
      --name <n>       Worker name (required)
      --kv <b>=<id>    KV binding (name=id)
      --do <b>=<c>     DO binding (name=class)
      --svc <b>=<w>    Service binding (name=worker)
      --var <k>=<v>    Plaintext var binding
      --secret <k>=<v> Secret binding (stored in secrets/<name>/)
      --cron <expr>    Cron trigger (5-field, e.g. "*/5 * * * *")
      --timeout <ms>   Per-request timeout override
      --compat <date>  Compatibility date (default: 2026-07-31)
      --dry-run        Validate syntax only, do not deploy
      --local          Force local runtime
      --cf             Force Cloudflare API

  list            List deployed Workers (local + CF)
  delete <name>   Delete a Worker
  secret put <name> <KEY> [value]   Store secret (stdin if no value)
  secret get <name> <KEY>           Read secret
  secret list <name>                List secret keys
  kv {create <n>|list}              KV namespaces
  kv key {get|put|delete|list} ...  KV operations (local runtime)
  tail <name> [-f]                  Per-worker log stream (JSON lines)
  health          Runtime + per-worker health
  metrics         Prometheus metrics
  routes          List local runtime routes
  versions <name> List deploy versions
  rollback <name> Revert to previous version
  cron <name> [expr]  Fire scheduled handler on demand (test)
  start [port] [--https]   Start local runtime server
  stop            Stop local runtime server
  logs            Show runtime stdout log
  version         Show version

${CYAN}EXAMPLES${NC}
  eondeploy deploy ./worker.js --name app --kv MY_KV=abc123
  eondeploy deploy ./worker.js --name app --secret API_KEY=sk-xxx --cron "*/5 * * * *"
  eondeploy secret put app API_KEY
  eondeploy tail app -f
  eondeploy start 8787 --https
EOF
}

# ─── Config ───────────────────────────────────────────────────
WORKER_NAME=""; WORKER_FILE=""; COMPAT_DATE="2026-07-31"
KV_BINDINGS=(); DO_BINDINGS=(); SVC_BINDINGS=(); VAR_BINDINGS=(); SECRET_BINDINGS=()
LOCAL=false; CF=false; DRY_RUN=false; CRON_EXPR=""; TIMEOUT_MS=""

parse_flags() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) WORKER_NAME="$2"; shift 2 ;;
      --kv) KV_BINDINGS+=("$2"); shift 2 ;;
      --do) DO_BINDINGS+=("$2"); shift 2 ;;
      --svc) SVC_BINDINGS+=("$2"); shift 2 ;;
      --var) VAR_BINDINGS+=("$2"); shift 2 ;;
      --secret) SECRET_BINDINGS+=("$2"); shift 2 ;;
      --cron) CRON_EXPR="$2"; shift 2 ;;
      --timeout) TIMEOUT_MS="$2"; shift 2 ;;
      --compat) COMPAT_DATE="$2"; shift 2 ;;
      --dry-run) DRY_RUN=true; shift ;;
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
  [ -z "$CLOUDFLARE_API_TOKEN" ] && { echo -e "${RED}ERROR: CLOUDFLARE_API_TOKEN not set${NC}" >&2; return 1; }
  if [ -n "$data" ]; then
    curl -s -X "$method" "$CF_API$endpoint" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" "$@"
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

  # Syntax validation gate (always, even for CF)
  if ! node --check "$file" 2>/dev/null; then
    # Some workers are plain scripts; try a tolerant check
    node -e "new Function(require('fs').readFileSync('$file','utf-8'))" 2>/dev/null \
      || { echo -e "${RED}✗${NC} Syntax check failed: $file" >&2; exit 1; }
  fi
  if [ "$DRY_RUN" = true ]; then
    echo -e "${GREEN}✓${NC} Syntax OK — dry run (not deployed)"
    return 0
  fi

  # Auto-detect: CF if token set, else local
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ "$LOCAL" = false ] && [ "$CF" = false ]; then
    CF=true
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

  local kv_json="[]"; local do_json="[]"
  if [ ${#KV_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${KV_BINDINGS[@]}"; do
      items+="{\"name\":\"${b%%=*}\",\"type\":\"kv_namespace\",\"namespace_id\":\"${b#*=}\"},"
    done
    items="${items%,}"; kv_json="[$items]"
  fi
  if [ ${#DO_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${DO_BINDINGS[@]}"; do
      items+="{\"name\":\"${b%%=*}\",\"type\":\"durable_object\",\"class_name\":\"${b#*=}\"},"
    done
    items="${items%,}"; do_json="[$items]"
  fi

  local script=$(cat "$file")
  local metadata=$(cat <<METADATA
{"body_part":"script","bindings":$(echo "$kv_json $do_json" | jq -s 'add')}
METADATA
)

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

  local base="$EON_ROOT/workers/$WORKER_NAME"
  mkdir -p "$base"

  # Atomic versioned deploy: v-<sha>/worker.js + meta.json, flip `current` symlink
  local sha
  sha=$(sha256sum "$file" | cut -c1-12)
  local version="v-$sha"
  local vdir="$base/$version"
  mkdir -p "$vdir"
  cp "$file" "$vdir/worker.js"

  # Secrets from --secret flags (stored in secrets/<name>/)
  if [ ${#SECRET_BINDINGS[@]} -gt 0 ]; then
    local sdir="$EON_ROOT/secrets/$WORKER_NAME"
    mkdir -p "$sdir"
    for s in "${SECRET_BINDINGS[@]}"; do
      local sk="${s%%=*}"
      local sv="${s#*=}"
      printf '%s' "$sv" > "$sdir/$sk"
      chmod 600 "$sdir/$sk"
      echo -e "${GREEN}✓${NC} Secret stored: $WORKER_NAME/$sk (0600)"
    done
  fi

  # Build meta.json with JSON array escaping
  local kv_json="[]"; local do_json="[]"; local svc_json="{}"; local vars_json="{}"
  if [ ${#KV_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${KV_BINDINGS[@]}"; do items+="\"$b\","; done
    kv_json="[${items%,}]"
  fi
  if [ ${#DO_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${DO_BINDINGS[@]}"; do items+="\"$b\","; done
    do_json="[${items%,}]"
  fi
  if [ ${#SVC_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${SVC_BINDINGS[@]}"; do items+="\"${b%%=*}\":\"${b#*=}\","; done
    svc_json="{${items%,}}"
  fi
  if [ ${#VAR_BINDINGS[@]} -gt 0 ]; then
    local items=""
    for b in "${VAR_BINDINGS[@]}"; do items+="\"${b%%=*}\":\"${b#*=}\","; done
    vars_json="{${items%,}}"
  fi

  cat > "$vdir/meta.json" <<META
{
  "name": "$WORKER_NAME",
  "version": "$version",
  "compat_date": "$COMPAT_DATE",
  "kv_bindings": $kv_json,
  "do_bindings": $do_json,
  "services": $svc_json,
  "vars": $vars_json,
  "crons": [$( [ -n "$CRON_EXPR" ] && echo "\"$CRON_EXPR\"" )],
  "timeout_ms": $( [ -n "$TIMEOUT_MS" ] && echo "$TIMEOUT_MS" || echo "null" ),
  "deployed_at": $(date +%s)
}
META

  # Flip current symlink (ln -sfn replaces the symlink itself, not its target dir)
  ln -sfn "$version" "$base/current"

  # Notify runtime (invalidate module cache)
  api POST "/__deploy" "{\"name\":\"$WORKER_NAME\",\"version\":\"$version\"}" > /dev/null 2>&1 \
    && echo -e "${GREEN}✓${NC} Deployed $WORKER_NAME@$version locally" \
    || echo -e "${YELLOW}⚠${NC} Runtime not running — saved versioned deploy to $vdir"
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
      if [ -f "$d/worker.js" ] || [ -L "$d/current" ]; then
        local ver=""
        if [ -L "$d/current" ]; then ver="$(readlink "$d/current")"; fi
        local crons=""
        if [ -f "$d/meta.json" ] || [ -f "$d/current" ]; then
          local mf="$d/meta.json"
          [ -L "$d/current" ] && mf="$d/$(readlink "$d/current")/meta.json"
          crons=$(python3 -c "import json;m=json.load(open('$mf'));c=m.get('crons',[]);print((' cron='+','.join(c)) if c else '')" 2>/dev/null)
        fi
        echo "  $name${ver:+@$ver}${crons}"
      fi
    done
  fi
}

# ─── Delete ───────────────────────────────────────────────────
cmd_delete() {
  local name="$1"
  [ -z "$name" ] && { echo -e "${RED}ERROR: name required${NC}" >&2; exit 1; }
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    cf_curl DELETE "/accounts/$CF_ACCOUNT/workers/scripts/$name" | \
      python3 -c "import sys,json;d=json.load(sys.stdin);print(f'CF: {d.get(\"errors\",[{}])[0].get(\"message\",\"deleted\")}')"
  fi
  api POST "/__undeploy" "{\"name\":\"$name\"}" > /dev/null 2>&1 || true
  rm -rf "$EON_ROOT/workers/$name" "$EON_ROOT/secrets/$name" 2>/dev/null && \
    echo -e "${GREEN}✓${NC} Deleted local: $name" || true
}

# ─── Secrets ──────────────────────────────────────────────────
cmd_secret() {
  local action="${1:-}"; shift
  case "$action" in
    put)
      local name="$1" key="$2" value="${3:-}"
      [ -z "$name" ] || [ -z "$key" ] && { echo -e "${RED}ERROR: secret put <name> <KEY> [value]${NC}" >&2; exit 1; }
      if [ -z "$value" ] && [ ! -t 0 ]; then value=$(cat); fi
      if [ -z "$value" ]; then
        read -r -s -p "Enter value for $key: " value; echo
      fi
      local sdir="$EON_ROOT/secrets/$name"
      mkdir -p "$sdir"
      printf '%s' "$value" > "$sdir/$key"
      chmod 600 "$sdir/$key"
      echo -e "${GREEN}✓${NC} Secret stored: $name/$key (0600)"
      ;;
    get)
      local name="$1" key="$2"
      [ -z "$name" ] || [ -z "$key" ] && { echo -e "${RED}ERROR: secret get <name> <KEY>${NC}" >&2; exit 1; }
      local f="$EON_ROOT/secrets/$name/$key"
      [ -f "$f" ] && cat "$f" || { echo -e "${RED}✗${NC} No such secret" >&2; exit 1; }
      ;;
    list)
      local name="$1"
      [ -z "$name" ] && { echo -e "${RED}ERROR: secret list <name>${NC}" >&2; exit 1; }
      local sdir="$EON_ROOT/secrets/$name"
      if [ -d "$sdir" ]; then
        ls -1 "$sdir" | while read k; do echo "  $k"; done
      else
        echo "  (no secrets)"
      fi
      ;;
    *)
      echo "Usage: eondeploy secret {put|get|list} <name> [KEY] [value]"
      ;;
  esac
}

# ─── KV ───────────────────────────────────────────────────────
cmd_kv() {
  local action="${1:-}"; shift
  case "$action" in
    create)
      local name="$1"
      mkdir -p "$EON_ROOT/kv/$name"
      echo -e "${GREEN}✓${NC} Local KV: $EON_ROOT/kv/$name"
      ;;
    list)
      ls -1 "$EON_ROOT/kv" 2>/dev/null | while read d; do echo "  $d"; done
      ;;
    key)
      local op="${1:-}"; shift
      local ns="${1:-default}"; shift
      case "$op" in
        get)    api POST "/__kv" "{\"action\":\"get\",\"namespace\":\"$ns\",\"key\":\"$1\"}" | python3 -m json.tool ;;
        getm)   api POST "/__kv" "{\"action\":\"get_meta\",\"namespace\":\"$ns\",\"key\":\"$1\"}" | python3 -m json.tool ;;
        put)    api POST "/__kv" "{\"action\":\"put\",\"namespace\":\"$ns\",\"key\":\"$1\",\"value\":\"$2\",\"opts\":{}}" | python3 -m json.tool ;;
        delete) api POST "/__kv" "{\"action\":\"delete\",\"namespace\":\"$ns\",\"key\":\"$1\"}" | python3 -m json.tool ;;
        list)   api POST "/__kv" "{\"action\":\"list\",\"namespace\":\"$ns\",\"opts\":{\"prefix\":\"$1\",\"limit\":1000}}" | python3 -m json.tool ;;
        *) echo "Usage: eondeploy kv key {get|put|delete|list} <ns> <key> [value]" ;;
      esac
      ;;
    *)
      echo "Usage: eondeploy kv {create|list|key}"
      ;;
  esac
}

# ─── Local Runtime Management ─────────────────────────────────
cmd_start() {
  local port="${1:-8787}"
  local https=""
  case "${2:-}" in
    --https|https) https="--https" ;;
  esac
  # Generate auth token on first start
  if [ ! -f "$TOKEN_FILE" ]; then
    local tok
    tok=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
    printf '%s' "$tok" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo -e "${CYAN}[eondeploy]${NC} Auth token created: $TOKEN_FILE (0600)"
  fi
  if [ -f /tmp/eon_runtime.pid ]; then
    local pid=$(cat /tmp/eon_runtime.pid)
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${GREEN}✓${NC} Runtime already running (PID $pid)"
      return 0
    fi
  fi
  nohup node "$EON_ROOT/eon_runtime.mjs" --port "$port" $https --token="$(cat "$TOKEN_FILE")" > /tmp/eon_runtime.log 2>&1 &
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

cmd_tail() {
  local name="${1:-}"
  local follow=""
  [ "${2:-}" = "-f" ] && follow="-f"
  [ -z "$name" ] && { echo -e "${RED}ERROR: eondeploy tail <name> [-f]${NC}" >&2; exit 1; }
  local log="$EON_ROOT/logs/$name.log"
  [ ! -f "$log" ] && { echo -e "${YELLOW}⚠${NC} No log yet for $name"; : > "$log"; }
  if [ -n "$follow" ]; then
    tail -f "$log" | python3 -c "
import sys,json
for line in sys.stdin:
    try:
        d=json.loads(line)
        print(f\"{d.get('ts','?')} [{d.get('level','?')}] {d.get('msg','')} {json.dumps({k:v for k,v in d.items() if k not in ('ts','level','msg')})}\")
    except: print(line,end='')
"
  else
    tail -20 "$log"
  fi
}

cmd_health() {
  api GET "/__health" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('runtime',{})
print(f\"Runtime v{r.get('version')} pid={r.get('pid')} uptime={r.get('uptime_s')}s\")
for w in d.get('workers',[]):
    mark='✓' if w['ok'] else '✗'
    print(f\"  {mark} {w['name']}@{w['version']} req={w['requests']} err={w['errors']}\" + (f\" cron={','.join(w['crons'])}\" if w['crons'] else ''))
"
}

cmd_versions() {
  local name="${1:-}"
  [ -z "$name" ] && { echo -e "${RED}ERROR: eondeploy versions <name>${NC}" >&2; exit 1; }
  local base="$EON_ROOT/workers/$name"
  [ -d "$base" ] || { echo -e "${RED}✗${NC} No such worker: $name"; exit 1; }
  local cur=""
  [ -L "$base/current" ] && cur=$(readlink "$base/current")
  echo -e "${CYAN}Versions for $name:${NC}"
  for v in "$base"/v-*; do
    [ -d "$v" ] || continue
    local vname=$(basename "$v")
    local mark=""
    [ "$vname" = "$cur" ] && mark=" ← current"
    local ts=$(stat -c %y "$v/worker.js" 2>/dev/null | cut -c1-19)
    echo "  $vname  ($ts)$mark"
  done
}

cmd_rollback() {
  local name="${1:-}"
  [ -z "$name" ] && { echo -e "${RED}ERROR: eondeploy rollback <name>${NC}" >&2; exit 1; }
  local base="$EON_ROOT/workers/$name"
  [ -L "$base/current" ] || { echo -e "${RED}✗${NC} No versioned deploys for $name"; exit 1; }
  local cur=$(readlink "$base/current")
  local prev=""
  for v in "$base"/v-*; do
    [ -d "$v" ] || continue
    local vname=$(basename "$v")
    [ "$vname" = "$cur" ] && continue
    if [ -z "$prev" ] || [ "$(stat -c %Y "$v/worker.js")" -gt "$(stat -c %Y "$base/$prev/worker.js")" ]; then
      prev="$vname"
    fi
  done
  [ -z "$prev" ] && { echo -e "${RED}✗${NC} No previous version"; exit 1; }
  ln -sfn "$prev" "$base/current"
  api POST "/__deploy" "{\"name\":\"$name\",\"version\":\"$prev\"}" > /dev/null 2>&1 || true
  echo -e "${GREEN}✓${NC} Rolled back $name: $cur → $prev"
}

cmd_cron() {
  local name="${1:-}"; local cron="${2:-* * * * *}"
  [ -z "$name" ] && { echo -e "${RED}ERROR: eondeploy cron <name> [expr]${NC}" >&2; exit 1; }
  echo -e "${CYAN}[eondeploy]${NC} Firing scheduled handler: $name ($cron)"
  api POST "/__scheduled" "{\"worker\":\"$name\",\"cron\":\"$cron\"}" | python3 -m json.tool
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
  secret)
    shift; cmd_secret "$@"
    ;;
  kv)
    shift; cmd_kv "$@"
    ;;
  tail)
    shift; cmd_tail "$@"
    ;;
  health)
    cmd_health
    ;;
  metrics)
    api GET "/__metrics"
    ;;
  versions)
    shift; cmd_versions "$@"
    ;;
  rollback)
    shift; cmd_rollback "$@"
    ;;
  cron)
    shift; cmd_cron "$@"
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
    api GET "/__routes" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Runtime not running"
    ;;
  version|--version|-v)
    echo "eondeploy v4.0.0 — EON Worker deploy tool"
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
