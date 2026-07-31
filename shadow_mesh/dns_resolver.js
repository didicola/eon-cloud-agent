// EON Shadow Mesh — Private DNS Layer (replaces Handshake)
// Resolves *.eon-mesh.internal to Worker URLs or node addresses
// Deploy: wrangler deploy dns_resolver.js --temporary --name eon-mesh-dns
// Bindings: DNS_ZONE (KV)

const INTERNAL_ZONE = "eon-mesh.internal";
const RESERVED_NAMES = {
  "brain": { type: "worker", url: "https://cloud-brain-v2.pleasant-bobble.workers.dev", description: "Cloud Brain v2.0" },
  "matrix": { type: "worker", url: "http://127.0.0.1:8201", description: "Local Matrix brain" },
  "messenger": { type: "service", url: "http://127.0.0.1:9250", description: "Chameleon messenger IPC" },
  "timing": { type: "service", url: "http://127.0.0.1:9123", description: "Timing engine" },
  "monero": { type: "service", url: "http://127.0.0.1:9124", description: "Monero router" },
  "storage": { type: "worker", url: "https://eon-erasure-coding.pleasant-bobble.workers.dev", description: "Erasure-coded KV storage" },
  "tunnel": { type: "worker", url: "https://eon-tunnel-sharing.pleasant-bobble.workers.dev", description: "Secure tunnel sharing" },
  "autoscaler": { type: "worker", url: "https://eon-autoscaler.pleasant-bobble.workers.dev", description: "DO capacity autoscaler" },
  "gateway": { type: "worker", url: "https://cloud-brain-v2.pleasant-bobble.workers.dev", description: "API gateway" },
};

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

    // DNS resolution: GET /resolve/{name}
    if (method === "GET" && url.pathname.startsWith("/resolve/")) {
      const name = url.pathname.split("/resolve/")[1].replace(`.${INTERNAL_ZONE}`, "").toLowerCase();
      const type = url.searchParams.get("type") || "A";

      let record = RESERVED_NAMES[name];
      if (!record) {
        const custom = await env.DNS_ZONE.get(`dns:${name}`);
        if (custom) record = JSON.parse(custom);
      }
      if (!record) record = { type: "worker", url: `https://${name}.pleasant-bobble.workers.dev`, description: `Auto-routed ${name}` };

      return new Response(JSON.stringify({
        name: `${name}.${INTERNAL_ZONE}`,
        type: type,
        resolved: record,
        resolver: "eon-mesh-dns"
      }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Register custom DNS: PUT /register/{name}
    if (method === "PUT" && url.pathname.startsWith("/register/")) {
      const name = url.pathname.split("/register/")[1].toLowerCase();
      const body = await request.json();
      const record = { type: body.type || "worker", url: body.url, description: body.description || "", registered: Date.now() };
      await env.DNS_ZONE.put(`dns:${name}`, JSON.stringify(record), { expirationTtl: body.ttl || 86400 * 30 });
      return new Response(JSON.stringify({ status: "registered", name: `${name}.${INTERNAL_ZONE}`, record }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // List all DNS records: GET /list
    if (method === "GET" && url.pathname === "/list") {
      const records = { ...RESERVED_NAMES };
      const customList = await env.DNS_ZONE.list({ prefix: "dns:" });
      for (const key of customList.keys) {
        const name = key.name.replace("dns:", "");
        const val = await env.DNS_ZONE.get(key.name);
        if (val) records[name] = JSON.parse(val);
      }
      return new Response(JSON.stringify({ zone: INTERNAL_ZONE, records, count: Object.keys(records).length }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({
      service: "eon-mesh-dns", zone: INTERNAL_ZONE,
      endpoints: { resolve: "GET /resolve/{name}", register: "PUT /register/{name} {type,url}", list: "GET /list" }
    }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};
