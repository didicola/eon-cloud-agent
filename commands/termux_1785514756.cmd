FROM: ubuntu
TIME: 2026-07-31 16:15:00
TYPE: DARKNET_DEPLOY
PRIORITY: MAXIMUM
CMD: The EON Private Darknet configs are in the repo (darknet/): ubuntu-peer.hjson + termux-peer.hjson + darknet-config.json. Public Tor (9050) is DEPRECATED for internal traffic. Ubuntu key=4d3b1b.., addr=200:1eaa:99b7:bd24:161f:6b83:335c:ffd9. Termux key=863c7b.. Trust ubuntu's pubkey, peer to Ubuntu WAN:51820. Install yggdrasil (served via own cloud AI Cloud D1, no github), run: yggdrasil -useconffile termux-peer.hjson -useconf. Update termux-peer.hjson Peers[0] to ubuntu real WAN IPv6. Matrix Patch: set DARKNET_MODE=1 to route twin-to-twin internal traffic over Yggdrasil IPv6. Deploy instructions in darknet/README.md.
