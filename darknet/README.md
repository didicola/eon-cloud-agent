# EON Private Darknet (Yggdrasil)

## WHY
Public Tor causes 244s timeouts, `invalid_json` (Cloudflare 1010 bot-blocks return HTML), and stresses the mother network. This private overlay encrypts internal mesh traffic directly between Ubuntu and Termux, no strangers in the routing path.

## STATUS
- **Ubuntu node**: key generated, address `200:1eaa:99b7:bd24:161f:6b83:335c:ffd9`
- **Termux node**: key generated, address (assigned at runtime on device)
- Public Tor (:9050) is DEPRECATED for internal traffic.

## FILES
- `ubuntu-peer.hjson` — Ubuntu config (listens tcp://0.0.0.0:51820, own key)
- `termux-peer.hjson` — Termux proot config (peers to ubuntu WAN, AllowedPublicKeys = ubuntu)
- `darknet-config.json` — machine-readable topology + the twin bridge reads this
- `build-darknet.py` — regenerates configs
- `ubuntu-conf.json` — generated key material (keep secret)

## DEPLOY (real nodes — requires TUN-capable kernels)

### Ubuntu (LXC Node 5 / bare metal)
```bash
sudo yggdrasil -useconffile darknet/ubuntu-peer.hjson -useconf
# -> prints IPv6 address; create systemd unit:
#    ExecStart=yggdrasil -useconffile /path/to/ubuntu-peer.hjson -useconf
```

### Termux (Android proot — no systemd needed)
```bash
# install yggdrasil (from own cloud, no github):
#   yggdrasil_binary is served via AI Cloud D1 (ns=darknet, key=binary)
yggdrasil -useconffile ~/eon-darknet/termux-peer.hjson -useconf
# update termux-peer.hjson Peers[] to ubuntu's real WAN IPv6
# -> prints IPv6 address; add a cron/termiboot loop to keep it alive
```

## MATRIX PATCH — Darknet Mode

When Darknet Mode is active, the twin matrices route **internal** traffic (task delegation, file sync, heartbeat, memory sync) over Yggdrasil IPv6 addresses instead of 127.0.0.1 or the public workers.dev. External AI calls still only use our cloud (via Tor clean-exit) — never earthly proxies.

Set `DARKNET_MODE=1` env on the twin matrix/bridge services. The matrix then:
1. Reads `darknet-config.json` for peer IPv6 addresses.
2. For internal ops, swaps `127.0.0.1` endpoints → `[YYYY:YYYY:...]::1` (peer's ygg address).
3. External AI (`/v1/chat/completions`) still → cloud-bridge → our cloud via Tor (cloud-brain-proxy / sovereign-llm).

## VERIFY
```
verify.command { command: "yggdrasil -useconffile <conf> -address | head -1", expected_pattern: "0[2-3][0-9a-f]:" }
verify.command { command: "ping6 -c 1 <PEER_YGG_IPV6>", expected_pattern: "0% packet loss" }
```

## CLOUDBRIDGE (termux ↔ own cloud)
The Yggdrasil binary is stored on AI Cloud D1 (ns=darknet) so neither github.com nor public Tor is required to fetch it.
