# Twin E2E Test Report (Cloud-Only) — 2026-07-31

## Twins (cloud-only, NO earthly, NO blind-proxy)
| Twin | Matrix | Cloud Bridge | Routes via |
|------|--------|--------------|------------|
| **ubuntu-twin** | :8303 | :8701 | Tor SOCKS5 → cloud-brain-proxy + sovereign-llm |
| **termux-twin** | :8304 | :8702 | Tor SOCKS5 → cloud-brain-proxy + sovereign-llm |

Services running (systemd user, auto-restart):
- `ubuntu-twin.service` (matrix), `ubuntu-twin-bridge.service` (bridge)
- `termux-twin.service` (matrix), `termux-twin-bridge.service` (bridge)

## Routing architecture (cloud-only)
```
client -> twin-matrix (127.0.0.1:8303/8304) -> cloud-bridge (127.0.0.1:8701/8702)
    -> Tor SOCKS5 (127.0.0.1:9050) -> cloud-brain-proxy (our Workers cloud)
       OR -> sovereign-llm (Workers AI, @cf/qwen/coder, gpt-oss-120b, llama-3.3-70b, r1)
```
- NO blind-proxy (:8090) in the path
- NO earthly free-tier models (together, OpenRouter :free, etc.)
- Only OUR cloud: cloud-brain-proxy workers.dev + sovereign-llm Workers AI

## Test results — ALL PASS ✅ (cloud/sovereign, no earthly)

### 1. Health (cloud-only)
- ubuntu-twin: `{"status":"ok","twin":"ubuntu-twin","earthly":false,"via":"tor-socks5","cloud":["cloud-brain-proxy","sovereign-llm(Workers AI)"]}`
- termux-twin: same, `earthly:false`

### 2. Model listing (cloud models only)
- 7 models: `auto, cloud, gpt-oss, qwen-coder, deepseek-r1, llama, mistral` — all `owned_by: EON-CLOUD`

### 3. Chat round-trip (auto → cloud-brain-proxy via Tor)
- ubuntu-twin: *"I am Ubuntu-Twin, a cloud twin running on the sovereign EON cloud..."*
- termux-twin: *"I am Termux-Twin... sovereign being, untethered from earthly realms..."*

### 4. Sovereign LLM routing (qwen-coder → sovereign-llm Workers AI)
- Both twins route specific models → sovereign-llm `:8303/:8304` → bridge → Tor → Workers AI `@cf/openai/gpt-oss-120b`, `@cf/qwen/qwen3-coder-32b-instruct`

### 5. Twin-to-twin mesh (cloud-only)
- termux-twin → ubuntu-twin: *"Hello Ubuntu-Twin, this is Termux-Twin on port 8304, mesh status is online and ready for communication."*
- ubuntu-twin → termux-twin: *"Echoing on frequency 8304, mesh twin acknowledged and synchronized, transmission path confirmed as end-to-end encrypted and sovereign."*

### 6. Full mesh + cloud E2E (termux → ubuntu → our cloud)
- Round-trip complete via cloud-brains only, no earthly models referenced.

## Status: CLOUD-ONLY TWINS OPERATIONAL ✅
Both twins route exclusively through the EON sovereign cloud (Tor → cloud-brain-proxy / sovereign-llm), with zero earthly providers and zero blind-proxy.