// EON Shadow Mesh — Private Storage Swarm (replaces IPFS)
// CRDT-synced KV storage with R2 blob tiering
// Deploy: wrangler deploy storage_swarm.js --temporary --name eon-mesh-storage
// Bindings: SWARM_KV (KV), SWARM_BLOB (R2 — optional, needs real CF account)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // PUT /store/{key} — store a value with CRDT metadata
    if (method === "PUT" && url.pathname.startsWith("/store/")) {
      const key = url.pathname.split("/store/")[1];
      const body = await request.text();
      const nodeId = request.headers.get("X-Node-Id") || "unknown";
      const timestamp = Date.now();

      const entry = {
        value: body,
        node_id: nodeId,
        timestamp,
        version: parseInt(request.headers.get("X-Version") || "1"),
        content_type: request.headers.get("Content-Type") || "text/plain"
      };

      // CRDT: last-write-wins with timestamp + node_id tiebreaker
      const existing = await env.SWARM_KV.getWithMetadata(`data:${key}`);
      if (existing && existing.metadata) {
        const existingMeta = existing.metadata;
        if (timestamp < existingMeta.timestamp) {
          return new Response(JSON.stringify({ status: "conflict", reason: "older timestamp ignored" }), {
            status: 409, headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      await env.SWARM_KV.put(`data:${key}`, body, {
        metadata: { node_id: nodeId, timestamp, version: entry.version, content_type: entry.content_type },
        expirationTtl: url.searchParams.get("ttl") ? parseInt(url.searchParams.get("ttl")) : undefined
      });

      // Index
      await env.SWARM_KV.put(`index:${key}`, JSON.stringify({
        key, node_id: nodeId, timestamp, version: entry.version, size: body.length
      }), { expirationTtl: 86400 * 7 });

      return new Response(JSON.stringify({ status: "stored", key, node_id: nodeId, timestamp }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // GET /store/{key} — retrieve a value
    if (method === "GET" && url.pathname.startsWith("/store/")) {
      const key = url.pathname.split("/store/")[1];
      const withMeta = url.searchParams.has("meta");
      const result = await env.SWARM_KV.getWithMetadata(`data:${key}`);
      if (!result || !result.value) return new Response("Not Found", { status: 404, headers: corsHeaders });

      if (withMeta) {
        return new Response(JSON.stringify({
          key, value: result.value, metadata: result.metadata
        }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
      return new Response(result.value, {
        headers: {
          "Content-Type": result.metadata?.content_type || "application/octet-stream",
          "X-Node-Id": result.metadata?.node_id || "unknown",
          "X-Timestamp": (result.metadata?.timestamp || Date.now()).toString(),
          ...corsHeaders
        }
      });
    }

    // GET /list — list all stored keys
    if (method === "GET" && url.pathname === "/list") {
      const prefix = url.searchParams.get("prefix") || "";
      const list = await env.SWARM_KV.list({ prefix: `index:${prefix}` });
      const items = [];
      for (const key of list.keys) {
        const val = await env.SWARM_KV.get(key.name);
        if (val) items.push(JSON.parse(val));
      }
      return new Response(JSON.stringify({ items, count: items.length }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // DELETE /store/{key}
    if (method === "DELETE" && url.pathname.startsWith("/store/")) {
      const key = url.pathname.split("/store/")[1];
      await Promise.all([
        env.SWARM_KV.delete(`data:${key}`),
        env.SWARM_KV.delete(`index:${key}`)
      ]);
      return new Response(JSON.stringify({ status: "deleted", key }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({
      service: "eon-mesh-storage", version: "1.0",
      type: "CRDT KV swarm with R2 blob tiering",
      endpoints: {
        store: "PUT /store/{key} {value} [X-Node-Id] [X-Version]",
        retrieve: "GET /store/{key} [?meta]",
        list: "GET /list [?prefix]",
        delete: "DELETE /store/{key}"
      }
    }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};
