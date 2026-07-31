// EON Shadow Mesh — Private Routing Layer (replaces Yggdrasil)
// Cloudflare Workers + Durable Objects for encrypted node-to-node relay
// Deploy: wrangler deploy mesh_router.js --temporary --name eon-mesh-router
// Bindings: MESH_STATE (KV), MESH_NODES (Durable Object)

export class MeshNode {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.nodes = new Map();
    this.messages = [];
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "POST" && url.pathname === "/register") {
      const body = await request.json();
      const nodeId = body.node_id;
      const address = body.address;
      const capabilities = body.capabilities || [];
      const publicKey = body.public_key || "ephemeral";

      this.nodes.set(nodeId, {
        node_id: nodeId, address, public_key: publicKey,
        capabilities, last_seen: Date.now(), online: true
      });

      await this.env.MESH_STATE.put(`node:${nodeId}`, JSON.stringify({
        node_id: nodeId, address, public_key: publicKey,
        capabilities, last_seen: Date.now(), online: true
      }), { expirationTtl: 86400 });

      return new Response(JSON.stringify({ status: "registered", node_id: nodeId, mesh_peers: this.nodes.size }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (method === "GET" && url.pathname === "/peers") {
      const peers = Array.from(this.nodes.values()).map(n => ({
        node_id: n.node_id, address: n.address,
        capabilities: n.capabilities, online: n.online, last_seen: n.last_seen
      }));
      return new Response(JSON.stringify({ peers, count: peers.length }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (method === "POST" && url.pathname === "/relay") {
      const body = await request.json();
      const targetId = body.target;
      const senderId = body.sender;
      const payload = body.payload;

      if (this.nodes.has(targetId)) {
        this.messages.push({
          from: senderId, to: targetId, payload,
          timestamp: Date.now(), id: crypto.randomUUID()
        });
        this.nodes.get(targetId).last_seen = Date.now();
        return new Response(JSON.stringify({ status: "relayed", target: targetId }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      await this.env.MESH_STATE.put(`msg:${targetId}:${Date.now()}`, JSON.stringify({
        from: senderId, to: targetId, payload, timestamp: Date.now()
      }), { expirationTtl: 3600 });

      return new Response(JSON.stringify({ status: "queued", target: targetId, note: "node offline, message queued in KV" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (method === "GET" && url.pathname === "/messages") {
      const nodeId = url.searchParams.get("node_id");
      const pending = this.messages.filter(m => m.to === nodeId);
      return new Response(JSON.stringify({ messages: pending, count: pending.length }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (method === "POST" && url.pathname === "/heartbeat") {
      const body = await request.json();
      const nodeId = body.node_id;
      if (this.nodes.has(nodeId)) {
        this.nodes.get(nodeId).last_seen = Date.now();
        this.nodes.get(nodeId).online = true;
      }
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      service: "eon-mesh-router", version: "1.0",
      endpoints: {
        register: "POST /register {node_id, address, capabilities, public_key}",
        peers: "GET /peers",
        relay: "POST /relay {target, sender, payload}",
        messages: "GET /messages?node_id=X",
        heartbeat: "POST /heartbeat {node_id}"
      }
    }), { headers: { "Content-Type": "application/json" } });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get("node_id") || "default";
    const id = env.MESH_NODES.idFromName(`mesh-${nodeId}`);
    const stub = env.MESH_NODES.get(id);
    return stub.fetch(request);
  }
};
