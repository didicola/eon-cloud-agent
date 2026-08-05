#!/bin/bash
# EON Sovereign Deployer — deploy apps through the swarm to the sovereign cloud
set -e

MATRIX="http://127.0.0.1:8200"
SWARM_CMD="eon-swarm"
CADDYFILE="$HOME/.local/share/caddy/Caddyfile"
APPS_DIR="/mnt/fluid-cloud/apps"

echo "🔥 EON Sovereign Deployer"
echo "   Matrix: $MATRIX"
echo "   Apps:   $APPS_DIR"
echo "   Swarm:  30 agent workers + 10 agent types"
echo ""

case "${1:-help}" in
    deploy|pipeline)
        shift
        python3 /home/ricos/eon-cloud-agent/eon_pipeline.py "$@"
        ;;
    list)
        echo "Deployed apps:"
        ls -la "$APPS_DIR" 2>/dev/null || echo "  (none yet)"
        echo ""
        echo "Swarm stats:"
        sqlite3 ~/.eon/swarm7000.db "SELECT COUNT(*) as tasks, status FROM tasks GROUP BY status" 2>/dev/null
        ;;
    matrix)
        echo "Testing Matrix :8200..."
        curl -s "$MATRIX/health" | python3 -m json.tool 2>/dev/null
        echo ""
        curl -s "$MATRIX/v1/models" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for m in d['data']: print(f'  {m[\"id\"]}')
" 2>/dev/null
        ;;
    swarm)
        echo "Swarm agents:"
        sqlite3 ~/.eon/swarm7000.db "SELECT status, COUNT(*) FROM workers GROUP BY status" 2>/dev/null || echo "  (no data)"
        echo ""
        echo "Recent tasks:"
        sqlite3 ~/.eon/swarm7000.db "SELECT substr(id,1,8), agent, substr(prompt,1,40), status FROM tasks ORDER BY time DESC LIMIT 10" 2>/dev/null
        ;;
    status)
        echo "=== EON AGI CLOUD STATUS ==="
        echo ""
        echo "Services:"
        for svc in eon-matrix-8200 eon-swarm7000 eon-master-daemon blind-proxy eon-sovereign-router fluid-gateway; do
            status=$(systemctl --user is-active "$svc" 2>/dev/null)
            icon="✅"; [ "$status" != "active" ] && icon="❌"
            echo "  $icon $svc"
        done
        echo ""
        echo "Matrix endpoints:"
        curl -s "$MATRIX/health" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  Models: blind-proxy(523) + sovereign(6) | Uptime: {d[\"uptime\"]}s')" 2>/dev/null
        echo ""
        echo "Swarm archive:"
        ls /mnt/fluid-cloud/ai-archive/swarm7000/ 2>/dev/null | tail -5
        echo ""
        echo "Storage:"
        df -h /mnt/fluid-cloud 2>/dev/null | tail -1
        ;;
    *)
        echo "Commands:"
        echo "  deploy <name|url>  — Deploy an app through the swarm"
        echo "  list               — List deployed apps and swarm stats"
        echo "  matrix             — Test the Matrix :8200 API"
        echo "  swarm              — Show swarm agent status"
        echo "  status             — Full system status"
        ;;
esac
