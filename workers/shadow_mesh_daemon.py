#!/usr/bin/env python3
"""EON Shadow Mesh — Node5 Registration & Heartbeat Daemon (SOVEREIGN TWIN).

All-in-cloud, no earthly: registers with the OWN mesh host (shadow-mesh.js on
:8787, /api/nodes), resolves the node roster, and syncs local memory into the
sovereign KV via the mesh. Stdlib-only (urllib) so it runs under the venv —
NO requests, NO cloudflare/github/mega, NO earthly endpoint.

    python3 shadow_mesh_daemon.py register    # one-shot register
    python3 shadow_mesh_daemon.py daemon      # loop: register + heartbeat + sync
    python3 shadow_mesh_daemon.py peers       # print online peers
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent.parent
MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
NODE_ID = "node5"
HEARTBEAT_INTERVAL = 60


def _load_token():
    token = os.environ.get("EON_ACCESS_TOKEN", "")
    if token:
        return token
    for p in ("state/.mesh-token.env", "/root/eon-cloud-agent/state/.mesh-token.env"):
        try:
            with open(p) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("EON_ACCESS_TOKEN="):
                        return line.split("=", 1)[1]
        except OSError:
            continue
    return ""


def _headers():
    h = {"Content-Type": "application/json"}
    token = _load_token()
    if token:
        h["Authorization"] = "Bearer " + token
    return h


def _post(path, obj):
    req = urllib.request.Request(
        f"{MESH}{path}",
        data=json.dumps(obj).encode(),
        headers=_headers(),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode() or "{}")


def _get(path):
    req = urllib.request.Request(f"{MESH}{path}", headers=_headers())
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode() or "{}")


class ShadowMesh:
    def __init__(self, node_id=NODE_ID):
        self.node_id = node_id
        self.peers = {}

    def register(self):
        local_services = [
            {"name": "infer-bridge", "port": 8201, "type": "internal", "url": "http://127.0.0.1:8201"},
            {"name": "eon-blind-proxy", "port": 8093, "type": "internal", "url": "http://127.0.0.1:8093"},
            {"name": "blind-proxy", "port": 8090, "type": "internal", "url": "http://127.0.0.1:8090"},
        ]
        payload = {
            "node_id": self.node_id,
            "address": f"{self.node_id}.eon-mesh.internal",
            "capabilities": ["compute", "storage", "relay", "dns", "gpu"]
                            + [s["name"] for s in local_services],
            "public_key": "ephemeral-node5",
            "services": local_services,
            "last_seen": int(time.time() * 1000),
        }
        try:
            result = _post("/api/nodes", payload)
            sys.stderr.write(f"[mesh] Registered as {self.node_id} — {result}\n")
            return result
        except Exception as e:
            sys.stderr.write(f"[mesh] Register error: {e}\n")
        return None

    def heartbeat(self):
        try:
            _post(f"/api/nodes/{self.node_id}/heartbeat", {"node_id": self.node_id})
            return True
        except Exception:
            return False

    def get_peers(self):
        try:
            d = _get("/api/nodes")
            if isinstance(d, list):
                nodes = d
            else:
                nodes = d.get("nodes", d.get("peers", []))
            self.peers = {n.get("node_id"): n for n in nodes if isinstance(n, dict)}
            return self.peers
        except Exception:
            return {}

    def sync_memory_to_mesh(self):
        try:
            import sqlite3
            db_path = BASE / "state" / "pheromones.db"
            if not db_path.exists():
                db_path = BASE / "pheromones.db"
            if db_path.exists():
                conn = sqlite3.connect(str(db_path))
                c = conn.cursor()
                c.execute("SELECT task_id, agent_id, type, strength, metadata FROM pheromones ORDER BY id DESC LIMIT 50")
                rows = c.fetchall()
                conn.close()
                count = 0
                for row in rows:
                    try:
                        _post("/api/memory/episodic", {
                            "episode": f"pheromone {row[0]}",
                            "tag": row[2] or "pheromone",
                            "emotional_weight": float(row[3] or 0),
                        })
                        count += 1
                    except Exception:
                        pass
                sys.stderr.write(f"[mesh] Synced {count} pheromones to sovereign mesh memory\n")
        except Exception as e:
            sys.stderr.write(f"[mesh] Memory sync error: {e}\n")

    def daemon(self):
        sys.stderr.write(f"[mesh] Starting Shadow Mesh daemon for {self.node_id} -> {MESH}\n")
        self.register()
        self.sync_memory_to_mesh()
        cycle = 0
        while True:
            try:
                cycle += 1
                ok = self.heartbeat()
                if not ok:
                    sys.stderr.write(f"[mesh] heartbeat lost — re-registering\n")
                    self.register()
                if cycle % 5 == 0:
                    peers = self.get_peers()
                    if peers:
                        sys.stderr.write(f"[mesh] {len(peers)} peers online\n")
                time.sleep(HEARTBEAT_INTERVAL)
            except KeyboardInterrupt:
                break
            except Exception as e:
                sys.stderr.write(f"[mesh] Daemon error: {e}\n")
                time.sleep(HEARTBEAT_INTERVAL)


if __name__ == "__main__":
    mesh = ShadowMesh()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "daemon"
    if cmd == "daemon":
        mesh.daemon()
    elif cmd == "register":
        mesh.register()
    elif cmd == "peers":
        print(json.dumps(mesh.get_peers(), indent=2, default=str))
    elif cmd == "sync":
        mesh.sync_memory_to_mesh()
    else:
        print("Usage: shadow_mesh_daemon.py [daemon|register|peers|sync]")
