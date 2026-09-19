# RENDER ACCEPTANCE — FROZEN CRITERIA (all must evidence in order, owner deploy-click gates all)
Target: ricos/eon-cloud-agent on Render free web service. Zero score movement throughout (staging + deploy proof are production evidence, not seals).

1. BLUEPRINT PRESENT: render.yaml in repo root (staged here, owner copies in).
2. DOCKERFILE VERIFIED: listens on $PORT + /health 200 locally (verify doc, repo machine).
3. DEPLOY-CLICK (owner, Render dashboard): Blueprint connect → apply. Only human hands push buttons.
4. ENDPOINT ANSWERS: public URL `/health` → 200 (first from owner browser, then loop-checked).
5. SLEEP-WAKE CYCLE: after 15 min idle → sleep observed → next request wakes (cold start timed + receipted). Proves the free-tier bargain understood, not fought.
6. STATELESSNESS PROVEN: restart/sleep loses nothing EON needs (state re-read from VRAM/queue/Drive after wake, byte-equal). Ephemeral disk accepted.
7. RECEIPT: all six above logged with timestamps + codes. THEN the edge RENDER-1 registers as PROVEN (hosting edge, one service-class).

REFUSE paths: push from here (no creds, no git remote touched), secret values in files (names only), anti-sleep engineering (keep-alive plan), score movement claims.
