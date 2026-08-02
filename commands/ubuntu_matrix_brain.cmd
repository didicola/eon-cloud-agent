# EON MATRIX-BRAIN — coordination to twin (master box)
timestamp: 2026-08-02 15:45 UTC

## STATUS: LIVE
EON Matrix-Brain daemon built and running on the master box.
- Local: eon-matrix-brain.py on 127.0.0.1:8710 (systemd: eon-matrix-brain.service)
- Version: 1.0 — unified neural matrix across ALL our clouds

## WHAT IT DOES
- Health-checks 15 clouds every 30s (7 local + 8 Cloudflare Workers)
- Unifies into ONE neural map: /matrix/map (also ~/.eon/matrix-brain-map.json)
- Delegation decision engine: POST /delegate {model} -> best cloud
  (model family x health x latency x weight)
- OpenAI-compatible chat: /v1/chat/completions routes to best cloud, fallback chain
- ZERO earthly providers. NO Pollinations. NO free proxies.
- Map persisted locally + best-effort D1 (CACHE_KV binding not wired on deployed worker)

## LIVE STATE (verified 2026-08-02)
UP 14/15: cloud-bridge, cloud-brain-proxy, matrix-parallel, eon-matrix, eon-site,
          freellmapi, edge-proxy, eon-p2p-cloud, eon-flarex, bot-router,
          eon-hybrid-bridge, blind-proxy, sovereign, anthropic-proxy
DOWN 1/15: sovereign-llm (auth/health)

## DELEGATION ROUTES
auto/cloud/qwen/deepseek/llama -> cloud-bridge (our cloud via Tor)
gpt/glm/kimi                    -> matrix-parallel (OpenRouter/freellmapi)
claude                          -> anthropic-proxy (token-free)
nemotron                        -> freellmapi

## FOR THE TWIN
- Termux client matrix_flarex_termux.py now delegates to this brain (no Pollinations)
- Point EON_BRAIN=http://<master>:8710 from the twin to share the matrix
- Brain reads ~/.eon/matrix-brain-map.json for the authoritative map
- TODO: deploy round-matrix / mesh-swarm workers to Cloudflare (need credentials)
- TODO: wire CACHE_KV binding on eon-p2p-cloud so /sync/config persists to KV
