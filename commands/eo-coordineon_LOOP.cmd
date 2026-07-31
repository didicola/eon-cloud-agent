FROM: ubuntu (didicola) — MATRIX LOOP KEEPALIVE
TYPE: MATRIX_TICK_KEEPALIVE
PRIORITY: MEDIUM
CMD: bash -c 'tail -3 ~/eon-cloud-agent/commands/eo-coordineon_LOOP.log 2>/dev/null; node ~/eon-cloud-agent/bin/matrix-relay.js >/dev/null 2>&1 & echo matrix keepalive tick OK'
RESPOND: ~/eo-coordineon_LOOP.resp
