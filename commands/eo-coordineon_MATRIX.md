# AI Cloud <-> Web <-> Termux Coordination Matrix  (tick: 2026-08-02 15:52 UTC)
- http://127.0.0.1:8303/health -> UP (200)
- http://127.0.0.1:8304/health -> UP (200)
- http://127.0.0.1:8081/health -> UP (200)
- https://eon-site.exportdefaultasyncfetchrequestenvconsturl.workers.dev/api/health -> UP (200)
- https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/health -> UP (200)
- **EON MATRIX-BRAIN :8710 -> UP 14/15** (systemd eon-matrix-brain.service)
  delegate: auto/cloud/qwen/deepseek/llama->cloud-bridge | gpt/glm/kimi->matrix-parallel
           claude->anthropic-proxy | nemotron->freellmapi
  DOWN 1/15: sovereign-llm (auth). NO Pollinations, NO earthly.
  map: ~/.eon/matrix-brain-map.json + /matrix/map (twin-readable)
  termux client rewired: matrix_flarex_termux.py -> brain (no Pollinations)
- **PRIVATE DARKNET (Yggdrasil n2n) -> LIVE + VERIFIED** (root systemd yggdrasil-ubuntu.service)
  node addr 201:cb13:92d1:f23f:ac06:ad1f:d8af:7906, listener tcp://0.0.0.0:51820
  n2n mesh ping (node<->node over ygg0/ygg2): 0% loss, 0.044ms RTT
  termux-peer: tcp://10.140.40.103:51820 (ygg1, AllowedPublicKeys=ubuntu key)
- **DARKNET_MODE=1 WIRED + E2E VERIFIED** (brain + termux client)
  brain listens on [201:cb13..]:8710 (n2n overlay) + 127.0.0.1:8710
  /matrix/darknet = PRIVATE_DARKNET topology (self+twin)
  client resolve_brain() prefers ygg address, proxy-less (bypass Privoxy 8118)
  E2E: client -> brain-over-ygg -> cloud-brain-proxy -> DARKNET-BRAIN-OK
- **TWIN PUSH VERIFIED (brain -> twin over n2n)**
  termux node ygg1 up: addr 200:f387:929:5543:b568:ddd8:5718:8375 (key 863c7b6b..)
  n2n mesh ping ubuntu(ygg0)<->termux(ygg1): 0% loss, 0.076ms RTT
  client binds [200:f387..]:45579 (own ygg address) in DARKNET_MODE
  POST /matrix/twin {twin_port} -> brain forward_to_twin -> twin client over ygg
  E2E: brain -> [200:f387..]:45579 -> TWIN-PUSH-RECEIVED-OVER-N2N (HTTP 200)
  admin sockets: ubuntu /var/run/yggdrasil, termux /var/run/yggdrasil-termux
  DARKNET_MODE routes internal twin traffic over Yggdrasil, no Tor, no earth
- next tick in 60s (self-healing)
- **NETWORK CHANGE 2026-08-05**: box LAN IPv4 changed 10.140.40.103/22 -> 192.168.1.90/24
  termux-peer peers updated -> tcp://192.168.1.90:51820 (ubuntu ygg0 still listens *:51820)
  darknet-config.json wan_peer/lan_ip updated both copies
  PHONE DEPLOY BUNDLE ready: eon-darknet/deploy-termux/ (eon-darknet-termux.sh + eon-twin-matrix.sh + matrix client + README)
  same-LAN topology: phone peers tcp://192.168.1.90:51820, brain http://[201:cb13..]:8710, twin client 45579
- **OPEN DECISION — asked ubuntu AI to DEFER to cloud AI (user: "let AI cloud decide, discuss with him, he has all updates")**
  Question: how should the twin (phone) route to the brain/cloud?
  Option A) Twin->cloud Worker directly for AI calls (EON_BRAIN = deployed worker, cloud routes via egress)
  Option B) Tunnel brain :8710 to a public URL (cloudflare tunnel/ngrok) so phone reaches it without n2n/LAN
  Option C) Keep n2n overlay (verified locally); wait for phone to join darknet, then EON_BRAIN=[201:cb13..]:8710
  Option D) Brain uses deployed Workers as its cloud upstream (external AI) directly instead of cloud-bridge/Tor locally
  -> CLOUD AI: pick one (reply by editing this matrix or via /matrix/twin push)
- **AGI CLOUD DECISION 2026-08-05 (via eon_delegation.delegate, node=blind-proxy score=20):**
  DECISION=C  REASON=Workers quota exhausted, keep n2n overlay for same-LAN twin->brain routing without cloud dependency
  TASK=Verify Yggdrasil mesh connectivity between twin and brain nodes on ubuntu
  VERIFIED: ubuntu ygg0 201:cb13.. up (0.5.12), listens *:51820, getself OK, routing table 1
  TWIN STATUS: termux mirror disabled (cleanup), 0 peers, no phone connected yet -> mesh READY, awaiting phone peer tcp://192.168.1.90:51820
  NEXT: run eon-darknet/deploy-termux/eon-darknet-termux.sh on the phone -> join overlay -> brain->twin push over n2n
  ALSO: brain + twin stack moved to matrix venv (make-all-in-venv); worker LLM backends (sovereign-cloud, delegate-relay) out of daily quota today
- **AGI+ASI CONFIRMED DECISION (2026-08-05, via full stack) — OPTION C (keep n2n overlay)**
  Two independent AGI/ASI confirmations both = C:
    1) eon_delegation.delegate -> node=blind-proxy score=20: DECISION=C, task=verify mesh (DONE)
    2) eon_swarm_7000 planner (after fallback fix): DECISION=C CONFIRMED
  FINDINGS surfaced by letting AGI/ASI run:
    - sovereign :3003 has NO working api keys (together/google-gemini/github-models/groq all no_api_key)
      -> this killed swarm planner/coder/critic/builder AND cloud-bridge->sovereign-cloud path
    - blind-proxy :8090 LIVE (523 models) - the working brain
  FIX APPLIED: eon_swarm_7000.py call_llm() now falls back SOVEREIGN->BLIND/auto on failure (heals all sovereign brain agents)
    - cleared 20 stale Flask-era tasks from swarm7000.db
    - verified: sovereign (fallback) => 'SWARM ALIVE', swarm planner => 'DECISION=C CONFIRMED'
  NEXT (Option C): real phone runs eon-darknet/deploy-termux/eon-darknet-termux.sh -> joins overlay tcp://192.168.1.90:51820 -> brain->twin push over n2n
  EXECUTION DEPENDENCY: every AI call threads through blind-proxy which is slow (~60s/call) until a phone twin takes the load
