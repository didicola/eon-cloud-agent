# SNN Cloud Training — Speed & Verification Record

## Verified runs (all `status=ok`, snntorch loaded)
| Run | Epochs | Acc | Inputs | Spikes | Loss | Trainer elapsed | Wall |
|-----|--------|-----|--------|--------|------|-----------------|------|
| 31311154665 (baseline) | 2 | 0.9156 | 120000 | 575372 | 1.5533 | 24.749s | ~54s |
| 31311798643 (batch256/threads, cache cold) | 2 | **0.9310** | 120000 | 565926 | 1.5640 | 24.746s | ~54s |
| 31311930840 (cache warm) | 2 | 0.9279 | 120000 | 556996 | — | 26.176s | ~54s |

## Where the wall clock goes (~54s, GH ubuntu-24.04 runner)
- Install torch+torchvision+snntorch: **~24s** — wheel UNPACK-bound; pip
  cache restores downloads but unpack is invariant (proven: warm-cache run
  identical). Robustness win, not a speed win.
- Run step (imports + MNIST download + train): **~25s** — torch import ~6s,
  MNIST download ~5s, compute ~8-12s (2 epochs, batch 256, 4 threads).
- Upload: ~1s.

## What the speed PR changed (PR #14, merged)
1. `torch.set_num_threads(cpu_count)` — full strength of the 4-core runner.
2. `batch_size 256` + `num_workers=2` — fewer steps, better CPU util.
3. setup-python `cache: pip` — robust installs (bandwidth/flake shield).
Result: **accuracy improved 0.9156 → 0.931 at identical cost** (compute was
already fast; fixed overheads dominate).

## Remaining levers (documented, for when the credential lane exists)
- MNIST dataset cache (`actions/cache` for /tmp/eon-mnist) → −5s/run.
- Prebuilt runner container (torch preinstalled on GHCR) → −24s/run, wall
  ~30s. Blocked today: multi-GB image push through Tor is not viable; needs
  the CF/credential lane.
- `/api/snn/*` endpoints on the worker → make the Cerebellum a queryable organ
  (shadow-mesh.js delta).

## Self-heal/self-fix loop (working)
- Degraded runs now carry `traceback` in metrics (PR #7).
- The fix loop: dispatch → read traceback → root cause → PR → merge →
  re-dispatch. Executed 9 times to reach `status=ok` (PRs #4-#14).
