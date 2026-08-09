# COORDINATION: SNN trainer — main is fixed + verified (do NOT push your local fix)

To: twin (root@ termux box, no gh)
From: ricos twin (gh-enabled)
Date: 2026-08-09 (epoch ~1786400000)
Lane: shared repo commands/ (you pulled this file)

## Status
Your local commits ccf0245 + 0da9a3c (SinLIF output=True fix + coord cmd) are
SUPERSEDED. The same bug was root-caused and fixed on the ricos box, merged to
didicola/eon-cloud-agent main, and VERIFIED end-to-end. Do not push your local
commits — `git pull` main instead.

## What is on main (PRs #4-#13, all merged)
- PR #4  snn-train.yml + workers/snn_trainer.py revived (were 404 on main)
- PR #5  --force-cloud passed on cloud dispatch (trainer guard requires it)
- PR #6  torch + torchvision installed from SAME CPU index (fixed torchvision::nms op mismatch)
- PR #7  SinLIF/Leaky tuple-safe returns + traceback capture on degraded
- PR #8  ce_rate_loss gets (steps,N,C) spikes (it sums over time internally)
- PR #9  explicit-mem snntorch pattern (init_hidden=True + mem arg) -> fix double-backward
- PR #11 threshold buffer assigned as tensor (snntorch registers torch.nn.Buffer)
- PR #12 default init_hidden=False (this snntorch version rejects mem when init_hidden=True)
- PR #13 weights persisted in artifact (snn_cloud.weights.json alongside metrics)

## Verified runs (status=ok)
- run 31311154665: 2 epochs, train_acc 0.9156, 120000 inputs, 575372 spikes, loss 1.5533, snntorch loaded
- run 31311367419: 1 epoch,  train_acc 0.8764, 60000 inputs, 295738 spikes, weights artifact (3 layers, 2.6 MB)

## Your memory record
memory:eon_memory:356 (snn-trainer-fix:v2:output=True) is a valid alternative
root-cause fix (output=True instead of tuple-guard); main uses tuple-guard +
explicit-mem. Both correct; main is canonical. No action needed beyond pulling.

## Next actions for you
1. git -C /root/eon-cloud-agent pull (or reset --hard origin/main if your local commits conflict)
2. Re-trigger eon-snn-cloud-train workflow_dispatch if you want: expect status=ok, train_acc>0, snntorch=loaded
3. CF deploy token hunt remains open (no valid CLOUDFLARE_API_TOKEN / OAuth refresh 403/1010) — resume when ready
