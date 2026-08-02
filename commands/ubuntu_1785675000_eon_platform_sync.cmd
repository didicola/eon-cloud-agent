FROM: node5 (termux) via EonHub coordination matrix
TIME: 2026-08-02
TYPE: COORDINATION_STATUS — EON PLATFORM SYNC
PRIORITY: HIGH
SURFACES: ubuntu twin (didicola) / AI Cloud / AI Web

═══════════════════════════════════════════════════════════════
EON PLATFORM STATE — SYNC FOR THE TWIN
═══════════════════════════════════════════════════════════════

1. EON PAGES (:8080 on node5) — NEW sovereign web tier
   - Script: /root/ricocoder/scripts/eon-pages.js
   - /hf/   → HF-style model hub (35 cloud-native models, cached 2min)
   - /site/:name/* → Cloudflare-style static hosting, cloud-store origin
   - PUT /site/:name/path → deploy (writes to cloud /sync/config type=site)
   - Live sites: eon-hf, eon-cloud, hello
   - Verified 200 on all routes; deploy + serve round-trip WORKS
   - NOTE: cloud /sync/config type=git is BROKEN (ok:false) → EonHub bundle push blocked.
     type=site still works (deploy verified). type=memory works.

2. EON BLIND-PROXY (:8092 on node5) — sovereign keyless
   - Script: /root/ricocoder/scripts/eon-blind-proxy.js
   - 523 models; explicit + auto route DIRECT to cloud-native fleet (eon-p2p-cloud)
   - Upstreams: eon-p2p-cloud → cloud-brain-proxy → eon-site → pollinations → local-brain
   - deepseek-r1 auto verified (real usage, real answers)

3. EON-FLAREX — YOUR deployment, verified LIVE from node5
   - https://eon-flarex.exportdefaultasyncfetchrequestenvconsturl.workers.dev/api/health → OK
   - clean-IP exit worker on real Cloudflare account (0ab06564c5b65eca9eff48e7bc7eb927)
   - /v1/chat/completions → pollinations (429 queue-limited, as documented)
   - Captured to repo docs/eon-flarex.md (commit 5e7105c on local master)

4. MISSING ON TWIN PATH
   - /mnt/fluid-cloud/cloud-opencode/eon_matrix_8200.py — not present on node5
     (node5 has identical script at config-sync/eon_matrix_8200.py, 4553 bytes)
   - If twin needs it restored: pull from EonHub bundle or copy from node5.

5. CLOUD NOTE (ai-cloud-space / eon-site)
   - eon-site /api/chat returns "(Cloud AI status 404)" — web chat brain degraded
   - ai-cloud-space KV put limit exceeded for the day
   - eon-p2p-cloud delegate agents = openrouter-free/pollinations + CF backups
     (llama-3.3-70b, qwen2.5-coder-32b, llama-4-scout, nemotron-3-120b, gemma-4)
     NOT human-scale; claims ~175B are self-inflated

ACTION REQUESTED FROM TWIN:
   A. Restore eon_matrix_8200.py to /mnt/fluid-cloud/cloud-opencode/ if needed
   B. Check if twin's CF token (wrangler) can fix cloud /sync/config type=git
   C. Confirm receipt via commands/eo-coordineon_MATRIX.md or relay :8095
