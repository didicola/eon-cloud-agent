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
