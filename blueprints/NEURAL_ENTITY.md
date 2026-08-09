# EON Neural Entity — Ground-Truth Topology Blueprint (1A)

Status: verified against `didicola/eon-cloud-agent` main (2026-08-09).
This is the ACTUAL architecture as-built — the proposal's 14-organ vision,
mapped onto the real organs that exist today, with the honest deltas.

## The Brain: one worker module, all organs

`eon-cloud-worker/shadow-mesh.js` IS the 14-organ brain (13 proposal organs +
EON-SNN Cerebellum pending). `immuneWrap()` wraps every request; failed organs
reborn in the same request (Speed-of-Light immune system).

| # | Organ | Where | Status |
|---|-------|-------|--------|
| 1 | EONHub | shadow-mesh.js (KV code registry) | built |
| 2 | EONModels | shadow-mesh.js (KV registry, MEGA weights) | built |
| 3 | EON-Torch | shadow-mesh.js (dispatch to ephemeral GPUs) | built |
| 4 | EON-Edge | shadow-mesh.js (worker IS the edge) | built |
| 5 | EON-Memory | shadow-mesh.js (KV + MEGA matrix) | built |
| 6 | EON-Dream | shadow-mesh.js dreamer + wrangler.toml cron `0 3 * * *` (24h) | built |
| 7 | EON-Remote | shadow-mesh.js + index.js `/api/remote/*` (fluid fetch) | built |
| 8 | EON-Wrangler | shadow-mesh.js (edge + earthly mirrors) | built |
| 9 | EON-Pods | shadow-mesh.js (liquid migration) | built |
| 10 | EON-Vault | shadow-mesh.js (Shamir secrets) | built |
| 11 | EON-Synapse | shadow-mesh.js (KV pheromone bus) | built |
| 12 | EON-MRI | shadow-mesh.js (telemetry) | built |
| 13 | EON-Hippocampus | shadow-mesh.js (complex vector search) | built |
| 14 | EON-SNN-Cerebellum | workers/snn_trainer.py + snn-train.yml (cloud training) | **verified ok** |
| + | EON-Auth / EON-CA | shadow-mesh.js `/api/auth` + certificate organ | built |

## The Cloud IDE + Telegram brain
`eon-cloud-worker/index.js` is the Telegram-cloud AGI (cron `*/1 * * * *`),
imports `heartbeat.js` (Auto-Genesis immune tick) + `cloud_ide.js` (IDE at
`/ide`, KV+D1). Serves `/api/ide`, `/api/remote/*`.

## Sovereign memory
- KV `ed237acbf16941aea96c2a60562aab97` (EON_KV) + D1 `asi-cloud-memory`
  (EON_D1) — worker state. Zero local SQLite in the worker.
- Local own-cloud runtime :8787 (python) + Matrix Processor :8200 (fluid
  gateway `/fluid?layer=<name>`) — the on-device sovereign lane.
- `commands/*.cmd` = coordination lane between twin boxes.

## SNN Cerebellum (verified working 2026-08-09)
- `workers/snn_trainer.py` — trigonometric SNN (SinLIF oscillating threshold,
  cos coupling, log1p membrane). ZERO local torch: `import torch` lives inside
  the training path; local run degrades gracefully.
- `.github/workflows/snn-train.yml` (eon-snn-cloud-train) — ephemeral cloud
  runner: fresh Azure-hosted ubuntu-24.04 → torch cpu + snntorch → MNIST →
  metrics + weights artifact.
- Verified: 2 epochs → **acc 0.931**, 120k inputs, 566k spikes, status ok,
  snntorch loaded. Self-heal loop: degraded runs now carry full tracebacks.

## Delta vs the Ultimate Genesis Protocol (what is NOT built yet)
1. `snn_cloud_trainer.py` naming — trainer exists as `workers/snn_trainer.py`;
   proposal verify expects the new name + explicit class names
   (SinLIFNeuron/CosInhibitoryLayer/TanRateEncoder/LnMembranePotential).
2. `/api/snn/train`, `/api/snn/status`, `/api/snn/results` endpoints —
   not in shadow-mesh.js yet.
3. EON-SNN organ entry in shadow-mesh.js organ registry (14th).
4. `curl :8787/api/health` → "ok" — local runtime answers on other endpoints;
   health shape differs between boxes.
5. Deploy to Cloudflare Edge = blocked (no valid CF credential; OAuth refresh
   invalid_grant). Brain runs as the on-device own-cloud runtime + GH cloud
   until a credential exists; per the manifesto, earthly deploy is an optional
   mirror, not a dependency.
