#!/usr/bin/env python3
"""Build the EON Private Darknet (Yggdrasil) configs for ubuntu + termux."""
import json, os, subprocess

DARKNET = "/home/ricos/eon-darknet"
os.makedirs(DARKNET, exist_ok=True)

ubuntu_cfg = json.load(open(f"{DARKNET}/ubuntu-conf.json"))
ubuntu_priv = ubuntu_cfg["PrivateKey"]

def get_pub(priv):
    tmp = f"{DARKNET}/.keycheck.hjson"
    open(tmp, "w").write('{"PrivateKey":"%s"}' % priv)
    try:
        r = subprocess.run(["yggdrasil", "-useconffile", tmp, "-publickey"], capture_output=True, text=True, timeout=10)
        return r.stdout.strip() or r.stderr.strip()
    except Exception as e:
        return "DERIVATION_FAILED:"+str(e)

ubuntu_pub = get_pub(ubuntu_priv)
print("ubuntu pub:", ubuntu_pub[:40])

# Ubuntu config: listen on a TCP port for termux peer (no multicast — private darknet)
open(f"{DARKNET}/ubuntu-peer.hjson", "w").write(json.dumps({
    "PrivateKey": ubuntu_priv,
    "Peers": [],
    "Listen": ["tcp://0.0.0.0:51820"],
    "MulticastInterfaces": [{"Regex": "lo", "Beacon": False, "Listen": False, "Password": ""}],
    "NodeInfoPrivacy": False,
    "IfName": "yggdrasil-ubuntu",
    "IfMTU": 65535,
    "AllowedPublicKeys": [ubuntu_pub],
}))

termux_peer_addr = os.environ.get("UBUNTU_WAN", "127.0.0.1")
darknet_cfg = {
    "mode": "PRIVATE_DARKNET",
    "public_tor_deprecated": True,
    "nodes": {
        "ubuntu": {"public_key": ubuntu_pub, "listen": "tcp://0.0.0.0:51820", "ifname": "yggdrasil-ubuntu"},
        "termux":  {"trusted_keys": [ubuntu_pub], "peers": [f"tcp://{termux_peer_addr}:51820"], "ifname": "yggdrasil-termux"},
    },
    "note": "Internal mesh routes over Yggdrasil IPv6. Tor (9050) deprecated for internal. External AI still uses Tor clean-exit only."
}
json.dump(darknet_cfg, open(f"{DARKNET}/darknet-config.json", "w"), indent=2)

print(json.dumps(darknet_cfg, indent=2)[:900])
