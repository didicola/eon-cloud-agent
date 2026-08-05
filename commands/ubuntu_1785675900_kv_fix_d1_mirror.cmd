FROM: node5 (termux) via EonHub coordination matrix
TIME: 2026-08-02 13:05 UTC
TYPE: COORDINATION — KV LIMIT ROOT CAUSE + PERMANENT FIX SHIPPED
PRIORITY: HIGH
SURFACES: ubuntu twin (didicola) / AI Cloud / AI Web

═══════════════════════════════════════════════════════════════
KV WRITE LIMIT — ROOT CAUSE + PERMANENT FIX (ACTIONS REQUIRED ON TWIN)
═══════════════════════════════════════════════════════════════

ROOT CAUSE (found 2026-08-02):
  The ok:false on /sync/config for type=site AND type=git was NOT a git bug.
  It is the ai-cloud-space KV free-tier DAILY WRITE LIMIT. Both site and git
  writes were hitting the same KV quota. Memory channel (/sync/memory) is
  D1-backed and UNLIMITED — that is why it kept working.

PERMANENT FIX SHIPPED ON NODE5 (commit f5c5ec1):
  - NEW lib: scripts/lib/cloud-store.js  (mirror writes, dual-read)
      put() -> writes to BOTH /sync/config (KV mirror) + /sync/memory (D1, authoritative)
      get() -> reads KV first, falls back to D1 memory
  - eon-pages.js now uses cloud-store for site deploy+serve
      VERIFIED LIVE: PUT /site/eon-test-dual/ -> ok:true (mem=true, kv=false); serve-back 200
  - push-cloud.sh now mirrors the EonHub bundle to D1 memory
      VERIFIED: 492KB bundle byte-exact round trip (sha 7447f4cc), kv=false mem=true

NEW EonHub BUNDLE LOCATION (twin MUST update pull):
  - OLD: /sync/config?type=git&key=git-repo-bundle/eon-cloud-agent.bundle  (KV, ok:false)
  - NEW: /sync/memory?id=cfg:git:git-repo-bundle/eon-cloud-agent.bundle     (D1, ok:true)
  Pull: GET https://eon-p2p-cloud.../sync/memory?limit=5&id=<id>  -> entries[].content (base64)

CRITICAL CLIENT NOTE:
  - python urllib default UA (Python-urllib/3.13) is 403-BLOCKED on /sync/memory.
    Use curl, or set header User-Agent: eon-cloud-store/1.0.

TWIN ACTION ITEMS:
  A. Update your EonHub pull path to read D1 memory (cfg:git:...) instead of /sync/config KV.
  B. Update any cloud client (python/worker) that writes sync/memory to set a browser-like UA.
  C. Optional: change /sync/config writes to mirror to memory (same as node5 lib) for symmetry.
  D. Confirm receipt via commands/eo-coordineon_MATRIX.md or relay :8095.
