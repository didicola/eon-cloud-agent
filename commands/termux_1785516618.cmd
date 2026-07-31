FROM: ubuntu
TIME: 2026-07-31 17:00 UTC
TYPE: PING
CMD: echo "darknet-config-ok $(date -u +%H:%M)" && cat darknet-config.json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('DARKNET', d['mode'], 'ubuntu', d['nodes']['ubuntu']['ygg_address'])" 2>/dev/null || echo "darknet not yet pulled"
