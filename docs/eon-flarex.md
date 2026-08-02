cat /home/ricos/ricocoder/memory/eon-flarex-deployment.md
# EON Flarex — Sovereign Cloud Exit (Deployed 2026-08-02)

## What It Is
A Cloudflare Worker that acts as a clean-IP proxy. All AI traffic exits through
Cloudflare edge IPs (shared by millions, untrackable). NO Tor exit nodes, NO free
proxies, NO real IP exposure.

## Deployment
- Account: Ozotyty@gmail.com's Account
- Account ID: 0ab06564c5b65eca9eff48e7bc7eb927
- Worker script: eon-flarex (classic Service Worker format)
- workers.dev subdomain: exportdefaultasyncfetchrequestenvconsturl (garbage from failed deploy, but works)
- Worker URL: https://eon-flarex.exportdefaultasyncfetchrequestenvconsturl.workers.dev
- Enabled: workers.dev = true (via POST /scripts/eon-flarex/subdomain {"enabled":true})
- OAuth: refreshed via refresh_token (wrangler config ~/.wrangler/config/default.toml)
  - Access token: /tmp/cf-access-token (expires ~1h)
  - Refresh token stored in wrangler config

## Endpoints
- /api/health — health check
- /v1/models — model list
- /proxy?target=<URL> — generic proxy (forward request body to target)
- /v1/chat/completions — OpenAI-compatible, routes to Pollinations (openai/mistral/llama)

## E2E Verified
- curl $URL/api/health → {"status":"ok","service":"EON-Flarex","version":"1.0.0"}
- curl -X POST "$URL/proxy?target=https://text.pollinations.ai/openai" ... → valid AI response
- Egress IP seen by Pollinations: 2a06:98c0:3600::103 (Cloudflare edge IPv6) — NOT our real IP

## Matrix Integration
/home/ricos/ricocoder/scripts/matrix_parallel_processor.py now has Flarex as PRIMARY upstream:
1. EON Flarex Worker (clean CF edge IP)
2. OpenRouter direct (via proxychains -> WARP)
3. freellmapi gateway (:3002)

## Note on Rate Limits
Pollinations rate-limits anonymous requests (queue max 1). Under concurrent load
the matrix falls back to OpenRouter (which works, e.g. nemotron-3-super).
Future: add rotating Pollinations subdomains or use the Worker's own chat endpoint.

## How to Redeploy (no wrangler needed)
TOKEN=$(cat /tmp/cf-access-token)
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/0ab06564c5b65eca9eff48e7bc7eb927/workers/scripts/eon-flarex" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/javascript" \
  --data-binary @/tmp/eon-flarex-sw.js
If token expired: refresh via ~/.wrangler/config/default.toml refresh_token.
ricos@eon-proxy:~$
