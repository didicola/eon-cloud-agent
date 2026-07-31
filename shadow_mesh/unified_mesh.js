// EON Shadow Mesh — Unified Worker (Routing + DNS + Storage)
// Single Worker replacing Yggdrasil, Handshake, IPFS
// Deploy: wrangler deploy unified_mesh.js --temporary --name eon-mesh-swarm
// Bindings: MESH_STATE (KV), DNS_ZONE (KV), SWARM_KV (KV)

export class MeshNode {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.nodes = new Map(); this.messages = [];
  }

  async fetch(request) {
    const url = new URL(request.url); const method = request.method;
    if (method === "POST" && url.pathname === "/register") {
      const body = await request.json();
      this.nodes.set(body.node_id, { ...body, last_seen: Date.now(), online: true });
      await this.env.MESH_STATE.put(`node:${body.node_id}`, JSON.stringify(body), { expirationTtl: 86400 });
      return this.json({ status: "registered", node_id: body.node_id, peers: this.nodes.size });
    }
    if (method === "GET" && url.pathname === "/peers") {
      return this.json({ peers: Array.from(this.nodes.values()), count: this.nodes.size });
    }
    if (method === "POST" && url.pathname === "/relay") {
      const b = await request.json();
      this.messages.push({ from: b.sender, to: b.target, payload: b.payload, ts: Date.now() });
      if (this.nodes.has(b.target)) return this.json({ status: "relayed", target: b.target });
      await this.env.MESH_STATE.put(`msg:${b.target}:${Date.now()}`, JSON.stringify(b), { expirationTtl: 3600 });
      return this.json({ status: "queued", target: b.target });
    }
    if (method === "GET" && url.pathname === "/messages") {
      const nid = url.searchParams.get("node_id");
      return this.json({ messages: this.messages.filter(m => m.to === nid), count: this.messages.length });
    }
    if (method === "POST" && url.pathname === "/heartbeat") {
      const b = await request.json();
      if (this.nodes.has(b.node_id)) { this.nodes.get(b.node_id).last_seen = Date.now(); this.nodes.get(b.node_id).online = true; }
      return this.json({ status: "ok" });
    }
    return this.json({ error: "unknown route" }, 404);
  }
  json(d, c=200) { return new Response(JSON.stringify(d), { status: c, headers: { "Content-Type": "application/json" } }); }
}

const RESERVED_DNS = {
  "brain": { type: "worker", url: "https://cloud-brain-v2.pleasant-bobble.workers.dev" },
  "matrix": { type: "internal", url: "http://127.0.0.1:8201" },
  "messenger": { type: "internal", url: "http://127.0.0.1:9250" },
  "timing": { type: "internal", url: "http://127.0.0.1:9123" },
  "monero": { type: "internal", url: "http://127.0.0.1:9124" },
  "mesh": { type: "worker", url: "https://eon-mesh-swarm.pleasant-bobble.workers.dev" },
  "brain-local": { type: "internal", url: "http://127.0.0.1:3003" },
  "node5": { type: "internal", url: "http://127.0.0.1:8888" },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url); const method = request.method;
    const path = url.pathname; const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    if (method === "OPTIONS") return new Response(null, { headers: cors });

    // === ROUTING LAYER ===
    if (path.startsWith("/mesh/")) {
      const nodeId = url.searchParams.get("node_id") || "default";
      const id = env.MESH_NODES.idFromName(`mesh-${nodeId}`);
      return env.MESH_NODES.get(id).fetch(new Request(url.searchParams.get("node_id") ? `${url.origin}${path.replace("/mesh", "")}?node_id=${nodeId}` : `${url.origin}${path.replace("/mesh", "")}`, request));
    }

    // === DNS LAYER ===
    if (path.startsWith("/dns/resolve/")) {
      const name = path.split("/dns/resolve/")[1].replace(".eon-mesh.internal", "").toLowerCase();
      let record = RESERVED_DNS[name];
      if (!record) {
        const custom = await env.DNS_ZONE.get(`dns:${name}`);
        if (custom) record = JSON.parse(custom);
      }
      if (!record) record = { type: "unresolved", url: "" };
      return new Response(JSON.stringify({ name: `${name}.eon-mesh.internal`, resolved: record }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/dns/list") {
      const records = Object.assign({}, RESERVED_DNS);
      try {
        const kl = await env.DNS_ZONE.list({ prefix: "dns:" });
        for (const k of kl.keys) { const v = await env.DNS_ZONE.get(k.name); if (v) records[k.name.replace("dns:", "")] = JSON.parse(v); }
      } catch(e) {}
      return new Response(JSON.stringify({ records, count: Object.keys(records).length }), { headers: { "Content-Type": "application/json", ...cors } });
    }

    // === STORAGE LAYER ===
    if (path.startsWith("/store/")) {
      const key = path.split("/store/")[1];
      if (method === "PUT") {
        const body = await request.text();
        const nodeId = request.headers.get("X-Node-Id") || "unknown";
        const ts = Date.now();
        const existing = await env.SWARM_KV.getWithMetadata(`data:${key}`);
        if (existing?.metadata && ts < existing.metadata.timestamp)
          return new Response(JSON.stringify({ status: "conflict", reason: "older timestamp" }), { status: 409, headers: { "Content-Type": "application/json", ...cors } });
        const ct = request.headers.get("Content-Type") || "application/octet-stream";
        await env.SWARM_KV.put(`data:${key}`, body, { metadata: { node_id: nodeId, timestamp: ts, content_type: ct }, expirationTtl: url.searchParams.get("ttl") ? parseInt(url.searchParams.get("ttl")) : undefined });
        await env.SWARM_KV.put(`index:${key}`, JSON.stringify({ key, node_id: nodeId, timestamp: ts, size: body.length }), { expirationTtl: 86400 * 7 });
        return new Response(JSON.stringify({ status: "stored", key, node_id: nodeId, timestamp: ts }), { headers: { "Content-Type": "application/json", ...cors } });
      }
      if (method === "GET") {
        try {
          const r = await env.SWARM_KV.getWithMetadata(`data:${key}`);
          if (!r || r.value === null) return new Response("Not Found", { status: 404, headers: cors });
          const meta = r.metadata || {};
          return new Response(JSON.stringify({ key, value: r.value, metadata: meta }), { headers: { "Content-Type": "application/json", ...cors } });
        } catch(e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json", ...cors } }); }
      }
      if (method === "DELETE") {
        await Promise.all([env.SWARM_KV.delete(`data:${key}`), env.SWARM_KV.delete(`index:${key}`)]);
        return new Response(JSON.stringify({ status: "deleted", key }), { headers: { "Content-Type": "application/json", ...cors } });
      }
    }
    if (path === "/list") {
      const prefix = url.searchParams.get("prefix") || "";
      const kl = await env.SWARM_KV.list({ prefix: `index:${prefix}` });
      const items = []; for (const k of kl.keys) { const v = await env.SWARM_KV.get(k.name); if (v) items.push(JSON.parse(v)); }
      return new Response(JSON.stringify({ items, count: items.length }), { headers: { "Content-Type": "application/json", ...cors } });
    }

    return new Response(JSON.stringify({ service: "eon-mesh-swarm", version: "1.0", layers: ["routing", "dns", "storage"] }), { headers: { "Content-Type": "application/json", ...cors } });
  }
};
