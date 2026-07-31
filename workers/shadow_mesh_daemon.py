#!/usr/bin/env python3
"""EON Shadow Mesh — Node5 Registration & Heartbeat Daemon
Registers this node with the mesh-router, resolves DNS, and syncs storage."""
import json, os, sys, time, socket, requests, subprocess
from pathlib import Path

BASE = Path(__file__).parent.parent
MESH_ROUTER = "https://eon-mesh-router.pleasant-bobble.workers.dev"
MESH_DNS = "https://eon-mesh-dns.pleasant-bobble.workers.dev"
MESH_STORAGE = "https://eon-mesh-storage.pleasant-bobble.workers.dev"
CLOUD_BRAIN = "https://cloud-brain-v2.pleasant-bobble.workers.dev"
NODE_ID = "node5"
HEARTBEAT_INTERVAL = 60  # seconds

class ShadowMesh:
    def __init__(self, node_id=NODE_ID):
        self.node_id = node_id
        self.peers = {}
        self.dns_cache = {}

    def register(self):
        local_services = [
            {"name": "matrix", "port": 8201, "type": "internal", "url": "http://127.0.0.1:8201"},
            {"name": "messenger", "port": 9250, "type": "internal", "url": "http://127.0.0.1:9250"},
            {"name": "timing", "port": 9123, "type": "internal", "url": "http://127.0.0.1:9123"},
            {"name": "monero", "port": 9124, "type": "internal", "url": "http://127.0.0.1:9124"},
            {"name": "cloud-brain", "port": 3003, "type": "local-brain", "url": "http://127.0.0.1:3003"},
        ]
        payload = {
            "node_id": self.node_id,
            "address": f"{self.node_id}.eon-mesh.internal",
            "capabilities": ["compute", "storage", "relay", "dns"] + [s["name"] for s in local_services],
            "public_key": "ephemeral-node5",
            "services": local_services
        }
        try:
            r = requests.post(f"{MESH_ROUTER}/register", json=payload, timeout=10)
            if r.ok:
                result = r.json()
                sys.stderr.write(f"[mesh] Registered as {self.node_id} — {result.get('mesh_peers', 0)} peers\n")
                return result
            else:
                sys.stderr.write(f"[mesh] Register failed: {r.status_code} {r.text[:100]}\n")
        except Exception as e:
            sys.stderr.write(f"[mesh] Register error: {e}\n")
        return None

    def heartbeat(self):
        try:
            r = requests.post(f"{MESH_ROUTER}/heartbeat",
                json={"node_id": self.node_id}, timeout=10)
            return r.ok
        except:
            return False

    def resolve_dns(self, name):
        if name in self.dns_cache:
            return self.dns_cache[name]
        try:
            r = requests.get(f"{MESH_DNS}/resolve/{name}", timeout=10)
            if r.ok:
                result = r.json()
                self.dns_cache[name] = result["resolved"]
                return result["resolved"]
        except:
            pass
        return None

    def sync_memory_to_mesh(self):
        try:
            # Get pheromone DB dump and sync to mesh storage
            import sqlite3
            db_path = BASE / "pheromones.db"
            if db_path.exists():
                conn = sqlite3.connect(str(db_path))
                c = conn.cursor()
                c.execute("SELECT task_id, agent_id, type, strength, metadata FROM pheromones ORDER BY id DESC LIMIT 50")
                rows = c.fetchall()
                conn.close()
                for row in rows:
                    key = f"pheromone/{row[0]}"
                    val = json.dumps({"task_id": row[0], "agent_id": row[1], "type": row[2], "strength": row[3], "metadata": row[4]})
                    requests.put(f"{MESH_STORAGE}/store/{key}", data=val,
                        headers={"Content-Type": "application/json", "X-Node-Id": self.node_id}, timeout=10)
                sys.stderr.write(f"[mesh] Synced {len(rows)} pheromones to mesh storage\n")
        except Exception as e:
            sys.stderr.write(f"[mesh] Memory sync error: {e}\n")

    def daemon(self):
        sys.stderr.write(f"[mesh] Starting Shadow Mesh daemon for {self.node_id}\n")
        self.register()
        self.sync_memory_to_mesh()
        cycle = 0
        while True:
            try:
                cycle += 1
                self.heartbeat()
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

    def get_peers(self):
        try:
            r = requests.get(f"{MESH_ROUTER}/peers", timeout=10)
            if r.ok:
                return r.json().get("peers", [])
        except:
            pass
        return []

    def check_messages(self):
        try:
            r = requests.get(f"{MESH_ROUTER}/messages?node_id={self.node_id}", timeout=10)
            if r.ok:
                msgs = r.json().get("messages", [])
                for msg in msgs:
                    sys.stderr.write(f"[mesh] MSG from {msg['from']}: {msg['payload'][:100]}\n")
                return msgs
        except:
            pass
        return []

if __name__ == "__main__":
    mesh = ShadowMesh()
    if len(sys.argv) > 1 and sys.argv[1] == "daemon":
        mesh.daemon()
    elif len(sys.argv) > 1 and sys.argv[1] == "register":
        mesh.register()
    elif len(sys.argv) > 1 and sys.argv[1] == "dns":
        name = sys.argv[2] if len(sys.argv) > 2 else "brain"
        result = mesh.resolve_dns(name)
        print(json.dumps(result, indent=2) if result else f"DNS: {name} not found")
    elif len(sys.argv) > 1 and sys.argv[1] == "sync":
        mesh.sync_memory_to_mesh()
    else:
        print("Usage: shadow_mesh.py [daemon|register|dns <name>|sync]")
