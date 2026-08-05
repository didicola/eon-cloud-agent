#!/bin/bash
# boot_stack.sh — start/repair the full EON sovereign stack in one command.
# Idempotent: starts each service only if not already running.
# Every daemon is FULLY detached (setsid + </dev/null + redirected stdout/stderr + disown)
# so the caller shell NEVER hangs on inherited fds — boot_stack.sh always returns.
# Usage: bash workers/boot_stack.sh
cd "$(dirname "$0")/.." || exit 1
W=workers
log() { echo "$(date -u +%FT%TZ) $1"; }

# start <pgrep-regex> <logfile> -- <cmd...>
# Launch <cmd...> detached only if nothing matches <pgrep-regex>. Returns instantly.
start() {
  local pat="$1"; shift
  local logf="$1"; shift
  if pgrep -f "$pat" >/dev/null 2>&1; then
    log "already running: $*"
    return 0
  fi
  setsid nohup "$@" >>"$logf" 2>&1 </dev/null &
  disown
  log "started: $*"
}

# 1. tor (onion HS)
start "tor -[f] /tmp/tor-min.conf" /tmp/tor.log -- tor -f /tmp/tor-min.conf

# 2. mesh-host (sovereign worker)
start "node $W/mesh-host.j[s]" /tmp/mesh-host.log -- node "$W/mesh-host.js"

# 3. supervisor (auto-restarts mesh-host) — dedupe: exact cmdline match
start "bash ($W/)?mesh-superviso[r].sh" /tmp/mesh-supervisor.log -- bash "$W/mesh-supervisor.sh"

# ── All python services run under the venv via the no-hang wrapper ──
# venv-run.sh <script.py> <logfile>: venv/bin/python + setsid + </dev/null + disown.
# Running inside the virtual environment means the child can never inherit a caller fd,
# so boot_stack always returns cleanly (rc=0) and yields exactly 1 process each.
W="$W"  # keep $W visible
runvenv() { bash venv-run.sh "workers/$1" "$2"; }

# 4. eon_neural_agent (local compute terminal)
start "venv/bin/python -u workers/eon_neural_agen[t].py" /tmp/eon-agent.log -- bash venv-run.sh "$W/eon_neural_agent.py" /tmp/eon-agent.log

# 5. fluid_bridge (:8401 routing)
start "venv/bin/python -u workers/fluid_bridg[e].py" /tmp/fluid-bridge.log -- bash venv-run.sh "$W/fluid_bridge.py" /tmp/fluid-bridge.log

# 6. snapshot_daemon (geo-redundancy mirror)
start "venv/bin/python -u workers/snapshot_daemo[n].py" /tmp/snapshot-daemon.log -- bash venv-run.sh "$W/snapshot_daemon.py" /tmp/snapshot-daemon.log

# 7. entropy_daemon (memory maintenance: age-out useless memories)
start "venv/bin/python -u workers/entropy_daemo[n].py" /tmp/entropy-daemon.log -- bash venv-run.sh "$W/entropy_daemon.py" /tmp/entropy-daemon.log

# 8. embed_shim (:11555) — permanent sovereign embedding round-matrix (real vectors, no earthly)
start "venv/bin/python -u workers/embed_shim[.]py" /tmp/embed-shim.log -- bash venv-run.sh "$W/embed_shim.py" /tmp/embed-shim.log

# 9. eon_self_heal_daemon (Autonomic Nervous System: sync + health checks + auto-repair, 60s)
start "venv/bin/python -u workers/eon_self_heal_daemo[n].py" /tmp/self-heal.log -- bash venv-run.sh "$W/eon_self_heal_daemon.py" /tmp/self-heal.log

# 10. eon_local_immunity (Digital Immune System: conflict/net/port/code repair, 15s)
start "venv/bin/python -u workers/eon_local_immunit[y].py" /tmp/immunity.log -- bash venv-run.sh "$W/eon_local_immunity.py" /tmp/immunity.log

# 11. round_matrix_daemon (Round-Matrix Sync: rotate local<->mirror<->twin, all things, 300s)
start "venv/bin/python -u workers/round_matrix_daemo[n].py" /tmp/round-matrix.log -- bash venv-run.sh "$W/round_matrix_daemon.py" /tmp/round-matrix.log

# 12. learn_daemon (Multiverse GPU Matrix + Continuous Learning cron: spawn->collect->collapse->hot-swap)
start "venv/bin/python -u workers/learn_daemo[n].py" /tmp/learn-daemon.log -- env EON_LEARN_COLLECT_WAIT=420 EON_LEARN_UNIVERSES=3 EON_LEARN_DIM=128 bash venv-run.sh "$W/learn_daemon.py" /tmp/learn-daemon.log

# 13. blind-proxy (:8090) — the 523-model OpenAI-compatible sovereign inference engine the
#     infer_bridge rotates across. Without it the bridge has no live LLM backend.
start "node (workers/\.\./scripts|scripts)/blind-proxy[.]j[s]" /tmp/blind-proxy.log -- node "$W/../scripts/blind-proxy.js"

# 15. eon-blind-proxy (:8093) — the sovereign workers/ copy ("inside him", in parallel).
#     Started as its own daemon on system boots; when absent, infer_bridge spawns it
#     embedded on the same port. Exactly one process must ever own :8093.
start "(workers|/root/eon-cloud-agent/workers)/eon-blind-proxy[.]j[s]" /tmp/eon-blind-proxy.log -- env EON_BP_PORT=8093 node "$W/eon-blind-proxy.js"
# Give the daemon a beat to bind :8093 BEFORE infer_bridge starts, so the bridge's
# ensure_embedded() reuses it instead of spawning a second, racing process.
for i in $(seq 1 16); do
  if curl -s -m 1 http://127.0.0.1:8093/v1/models >/dev/null 2>&1; then break; fi
  sleep 0.5
done

# 14. infer_bridge (:8201) — sovereign Inference Bridge: OpenAI-compatible + SSE streaming,
#     Ghost-Round-Matrix failover on "503 The request queue is full" so opencode never sees it.
#     ensure_embedded() prefers :8093 and reuses the daemon above (no double spawn).
start "venv/bin/python -u workers/infer_bridg[e].py" /tmp/infer-bridge.log -- bash venv-run.sh "$W/infer_bridge.py" /tmp/infer-bridge.log

# 16. shadow_mesh_daemon — sovereign node registration/heartbeat against own mesh
#     (:8787 /api/nodes). Stdlib-only venv twin; registers node5, heartbeats every 60s,
#     syncs pheromone memory into sovereign KV. Replaces the old earthly
#     *.pleasant-bobble.workers.dev registration daemon (zero earthly endpoints).
start "venv/bin/python -u workers/shadow_mesh_daemo[n].py" /tmp/shadow-mesh-daemon.log -- bash venv-run.sh "$W/shadow_mesh_daemon.py" /tmp/shadow-mesh-daemon.log

# 17. cloud_gpu_runner — sovereign cloud-GPU ML runner: pulls /api/ml/job/latest,
#     trains (dry-run-cpu on this box, real torch/--force-cloud when a GPU runner joins),
#     POSTs /api/ml/complete (promotes weights -> model:active_version -> state/models mirror).
start "venv/bin/python -u workers/cloud_gpu_runne[r].py" /tmp/cloud-gpu-runner.log -- bash venv-run.sh "$W/cloud_gpu_runner.py" /tmp/cloud-gpu-runner.log

# 18. eon_gpu_node — registers gpu-node1 as a real compute+gpu node + heartbeat loop,
#     so GPU-aware /api/compute/dispatch has a live target (fixes the phantom gpu-node1).
start "venv/bin/python -u workers/eon_gpu_no[de].py" /tmp/eon-gpu-node.log -- bash venv-run.sh "$W/eon_gpu_node.py" /tmp/eon-gpu-node.log

# 19. lan_sync_server — LAN file-sync door for the twin Ubuntu: browse/read the full
#     arch tree, token-gated write/make/mkdir/delete. Binds the LAN IP only (wlan0),
#     stdlib-only, so the second Ubuntu can inspect + modify the arch directly.
start "venv/bin/python -u workers/lan_sync_serve[r].py" /tmp/lan-sync-server.log -- env EON_LAN_BIND=192.168.1.146 EON_LAN_PORT=8788 bash venv-run.sh "$W/lan_sync_server.py" /tmp/lan-sync-server.log

log "boot complete — verifying health"
sleep 3
curl -s -m 3 http://127.0.0.1:8787/api/health | head -c 60; echo
curl -s -m 3 http://127.0.0.1:8201/health | head -c 80; echo
log "roster:"
ps aux | grep -E "tor -[f]|mesh-host.j[s]|mesh-superviso[r]|eon_neural_agen[t]|fluid_bridg[e]|snapshot_daemo[n]|entropy_daemo[n]|embed_shim[.]py|eon_self_heal_daemo[n]|eon_local_immunit[y]|round_matrix_daemo[n]|learn_daemo[n]|blind-proxy[.]j[s]|eon-blind-proxy[.]j[s]|infer_bridg[e]" | grep -v grep | awk '{print "  ", $2, $11, $12}'
