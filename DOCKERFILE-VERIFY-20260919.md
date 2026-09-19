# DOCKERFILE VERIFY — STAGED CHECKLIST (run where the repo is visible: Warp/Ubuntu)
Repo: ricos/eon-cloud-agent, root Dockerfile. Nothing pushed from here.

## CHECKS (all must pass before deploy-click)
1. `grep -i '^EXPOSE' Dockerfile` → note port (informational; Render overrides with $PORT).
2. Container must LISTEN on `$PORT` (Render injects it). Fail = fix Dockerfile CMD to bind 0.0.0.0:$PORT.
3. `GET /health` must return 200 with tiny body (e.g. `{"ok":true}`). If missing, add ONE of below (delete the other):

### Node/Express (server.js or app.js)
```js
app.get('/health', (req, res) => res.status(200).json({ ok: true }));
```

### Python/Flask (app.py)
```python
@app.get("/health")
def health():
    return {"ok": true}, 200
```

4. Local prove (repo machine): `docker build -t eon-local . && docker run -e PORT=10000 -p 10000:10000 eon-local` then `curl -s -o /dev/null -w "%{http_code}" localhost:10000/health` → expect 200.
5. Fill render.yaml FILL-ME section from Dockerfile ENV names (keys only, values in Render dashboard, never in git).

## WALLS (Render free, frozen facts)
512MB RAM / 0.1 CPU shared · sleep after 15 min idle (cold start on wake) · ephemeral disk (nothing persists locally — state lives in VRAM/Drive/queue) · no cron, no workers, no SSH · 750 hrs/mo (one service fits).
