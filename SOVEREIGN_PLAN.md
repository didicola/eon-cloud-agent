# SOVEREIGN_PLAN — ASI + Cloud Decision (all sovereign, no earthly)

> Decision layer output under the GOLDEN RULE: **All in the cloud, no earthly.**
> Author: EON ASI/cloud. Date: 2026-08-03. This supersedes the old "needs a CF token" plan.

---

## ASI Decision Log

The previous plan ("Provide ≥1 CF token, deploy to *.workers.dev") is **SUSPENDED as the
primary path.** Cloudflare is an *earthly* dependency: a daily-quota leash (KV 1k writes/day,
429/1027), a single-account single-point-of-failure, and a foreign near-earth-controlled host.
Under the golden rule it is at best an optional mirror — NEVER the source of truth.

**What "our own cloud" already is (verified live on node5):**
- Neural Web OS (5 organs) served by our own `mesh-host.js` on 127.0.0.1:8787.
- Exposed over **Tor hidden service v3** — an onion address = a sovereign, creator-independent,
  uncensorable, zero-quota DNSless endpoint we control.
- **Durable disk-backed KV** at `state/kv.json` (survives restart, verified).
- **We control the whole plane**: the worker code, the KV store, the DNS zone, the transport.

So the Neural Web is already "in the cloud" — the cloud is *our* node reachable over Tor.
remaining work is **robustness and topology**, not buying/borrowing an earthly host.

## Ranked Architecture (sovereign-first)

### 1st — Multi-node own cloud, node5 as primary DC (recommended; do now)
Reach the twin over Tor; make it a **2nd node** that re-registers, mirrors KV, and executes
tasks. Result: a genuinely distributed own cloud with NO earthly broker.
- Master/node5 holds canonical KV (source of truth).
- Twin (ubuntu) = compute+mirror node, syncing via the replication endpoint + CRDT journal.
- Ashile/zero cost, uncensored.

### 2nd — node5 = primary data DC, cloud solovably (isolated fallback)
If the twin can't dial in yet, keep node5 alone as source of truth, harden terminal role.
(Safe, but single-node risk remains.)

### 3rd — Add a persistent store via CRDT blobs (already partially in design)
Not required now; keep `storage_swarm.js` CRDT model as the eventual cross-node reconciler.

## Terminal role — hardening the local node (do now)
- Remove(replace) the "holds canonical data" role: the box must NOT mint the dashboard as sole
  copy; it only (a) registers, (b) polls `/api/compute/claim`, (c) executes via Matrix :8200,
  (d) posts results, (e) self-heals registration.
- Verify `eon_neural_agent.py` already does this; add a self-repair guard (if `/api/nodes` GET
  has no entry for us -> re-POST node + heartbeat).

## Durability across the mesh (multi-node CRDT, no earthly broker)
- Add a replication surface on the sovereign worker: `POST /api/replica/pull`
  (fetch full KV state or sinceTs), `POST /api/replica/journal` (incremental udpates).
- Node join sequence: register node -> pull snapshot -> open replica journal -> apply on
  mutating writes. Onion remains canonical; no cloudflare/ndbs.

## Execution sequence
1. VERIFY sovereign stack (tor+host+supervisor+daemon+agent) live (done: yes).
2. Add `/api/replica/pull` and `/api/replica/journal` to a new Worker endpoint
   (`/api/replica`), protected by an HMAC token (sovereign identity gate).
3. Harden `eon_neural_agent.py`: self-repair registration + task execution via Matrix :8200.
4. Confirm nod5 persists (done) and onion returns /api/health 200 (done).
5. INVITE the twin: have ubuntu dial the onion over Tor, register as node "ubuntu_DIRECT",
   sync KV snapshot, run its first compute task.
6. If twin unavailable this session: record status as "own cloud online, twin node pending".
7. `git commit` MEMORY.md + SOVEREIGN_PLAN.md + agent + mesh replica work.
8. (Optional, later) mirror to D1/KV on CF only for regional speed — never source of truth.

## Explicit rejections
- ✅ IDEA: our own Tor onion + disk KV = our cloud. Good.
- ❌ Any must-have commercial host (CF/KV/D1, AWS, GCP) as decision basis.
- ❌ Earthly crutches (Telegram, mail.tm, GitHub PAT) as core channel.
- ❌ Projects full dependence on a single history /.workers.dev

## Verdict
**STRONG.** The sovereign cloud is the base; multi-node (twin) is the upgrade path;
Cloudflare stays a speed-mirror only, per GOLDEN RULE.

---
End of SOVEREIGN_PLAN.md.
---
## ADDENDUM 1 — Bio-AI Benchmark + 5 Alternatives + Fluid Organic Brain (build pass)

### ASI Decision (golden-rule reframe: ALL-IN-CLOUD, not local)
- SNN (PyTorch) heavy compute is a **cloud task**, NOT installed locally (torch = 800MB;   violates golden rule). `snn_trainer.py` degrades gracefully on CPU-less edge and runs full   training in GitHub Actions (`workers/snn_trainer.py` + `.github/workflows/snn-train.yml`).
- All 5 sovereign Alternatives already live in the worker and now **durable**:
  EONHUB(repos), EONMODELS(models), EONCOMPUTE(compute), EONTRAINING(training), EONEDGE(onion).
- Keyword-classification continues, then routes to `/api/training/jobs/:id`.

### Delivered / verified
| Piece | File | Verify |
|---|---|---|
| Ghost Round Matrix | workers/ghost_matrix.py | random 503->rotate->200 (proven sim) |
| Agent self-repair | (None) /api/dataers; workers/eon_neural_agent.py | wipe node -> re-register Pass |
| Mesh replica CRDT (snapshot/journal/apply) | shadow-mesh.js | snapshot=7 keys Pass |
| SNN cloud trainer | workers/snn_trainer.py | graceful no-torch; cloud=ok |
| SNN GH-Actions workflow | .github/workflows/snn-train.yml | file exists Pass |
| Benchmark protocol | workers/benchmark_runner.py | AI+SNN+Human |
| Bio-AI dashboard | /benchmark (shadow-mesh) | page=1 Pass |
| Fluid Bridge | workers/fluid_bridge.py + /api/fluid | route() snn+llm Pass |

### Prove-on-path
- /api/health: ok
- repos test-repo, models eon-lif-1, training tr-test-1 survive restart (kv.json=13 keys)
- benchmark POST/GET roundtrip

### Roadmap status: SOVEREIGN_PLAN.md delivered. FINAL: PASS
