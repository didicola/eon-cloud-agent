// EON Neural Web — Parallel Internet OS (v4)
// Organs: Own GitHub (code) · Own HuggingFace (models) · Own VPS (compute) · Own Data Centers (training) · Identity/Auth
// KV design (free tier: 100k reads / 1k writes / 1k lists per day, 1GB, 25MB value):
//   - single namespace, prefixed keys; list() only on index keys, not data keys
//   - writes coalesced: register = 1 put, heartbeat = 1 put, commit = 2 puts
// Deploy: wrangler deploy src/index.js --name eon-neural-web
// Bindings: NEURAL_KV (KV), MESH_STATE (KV), DNS_ZONE (KV), SWARM_KV (KV)

const SOVEREIGN_HS = "http://o3izfmjjt2pmsgauio7fau3ykiwm5ion4ltojv7zegdpp7n74tfqsqad.onion:80";
const ORG = "node5";
const LAYERS = ["identity", "git", "models", "compute", "training", "dns", "storage", "mesh"];

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Node-Id, Authorization" };
const J = (d, c = 200) => new Response(JSON.stringify(d), { status: c, headers: { "Content-Type": "application/json", ...cors } });
const T = (s, c = 200) => new Response(s, { status: c, headers: { "Content-Type": "text/html; charset=utf-8", ...cors } });

async function sha256(str) {
  if (crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

export class MeshNode {
  constructor(state, env) { this.state = state; this.env = env; this.nodes = new Map(); this.messages = []; }
  async fetch(request) {
    const url = new URL(request.url); const method = request.method;
    if (method === "POST" && url.pathname === "/register") {
      const body = await request.json();
      this.nodes.set(body.node_id, { ...body, last_seen: Date.now(), online: true });
      await this.env.MESH_STATE.put(`node:${body.node_id}`, JSON.stringify(body), { expirationTtl: 86400 });
      return J({ status: "registered", node_id: body.node_id, peers: this.nodes.size });
    }
    if (method === "GET" && url.pathname === "/peers") return J({ peers: Array.from(this.nodes.values()), count: this.nodes.size });
    if (method === "POST" && url.pathname === "/relay") {
      const b = await request.json();
      this.messages.push({ from: b.sender, to: b.target, payload: b.payload, ts: Date.now() });
      if (this.nodes.has(b.target)) return J({ status: "relayed", target: b.target });
      await this.env.MESH_STATE.put(`msg:${b.target}:${Date.now()}`, JSON.stringify(b), { expirationTtl: 3600 });
      return J({ status: "queued", target: b.target });
    }
    if (method === "GET" && url.pathname === "/messages") {
      const nid = url.searchParams.get("node_id");
      return J({ messages: this.messages.filter(m => m.to === nid), count: this.messages.length });
    }
    if (method === "POST" && url.pathname === "/heartbeat") {
      const b = await request.json();
      if (this.nodes.has(b.node_id)) { this.nodes.get(b.node_id).last_seen = Date.now(); this.nodes.get(b.node_id).online = true; }
      return J({ status: "ok" });
    }
    return J({ error: "unknown route" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url); const method = request.method;
    const path = url.pathname;
    if (method === "OPTIONS") return new Response(null, { headers: cors });
    const kv = env.NEURAL_KV || env.SWARM_KV;
    const p = path.replace(/\/+$/, "");
    const [s1, s2, s3] = p.split("/").filter(Boolean);

    // ============ ROOT: LIVE HTML DASHBOARD ============
    if (p === "" || p === "/") return T(dashboard(env, kv));

    // ============ API: HEALTH ============
    if (p === "/api/health") {
      return J({ status: "ok", service: "eon-neural-web", version: "4.0", organ_count: 5, node: ORG, mesh: SOVEREIGN_HS, uptime: Date.now() });
    }

    // ============ API: IDENTITY LAYER (/api/nodes) ============
    if (p === "/api/nodes" && method === "GET") {
      const list = await kv.list({ prefix: "node:" });
      const nodes = [];
      for (const k of list.keys) {
        const segs = k.name.split(":");
        if (segs.length !== 2) continue; // only node:<id>, skip :hb and :task:
        const v = await kv.get(k.name);
        if (v) { try { nodes.push(JSON.parse(v)); } catch (e) {} }
      }
      return J(nodes);
    }
    if (p === "/api/nodes" && method === "POST") {
      const body = await request.json();
      const nodeId = body.node_id || body.id;
      if (!nodeId) return J({ error: "node_id required" }, 400);
      const now = Date.now();
      const ex = await kv.get(`node:${nodeId}`);
      const prev = ex ? JSON.parse(ex) : {};
      const node = {
        node_id: nodeId,
        name: body.name || nodeId,
        addr: body.addr || prev.addr || null,
        type: body.type || prev.type || "node",
        capabilities: body.capabilities || prev.capabilities || [],
        services: body.services || prev.services || {},
        registered: prev.registered || now,
        last_seen: now,
        heartbeats: (prev.heartbeats || 0) + 1,
        reputation: Math.min(100, (prev.reputation || 50) + (body.health === false ? -5 : 1)),
        status: "online"
      };
      await kv.put(`node:${nodeId}`, JSON.stringify(node));
      await kv.put(`node:${nodeId}:hb`, String(now), { expirationTtl: 3600 });
      return J({ status: "registered", node, reputation: node.reputation });
    }
    if (p.startsWith("/api/nodes/") && method === "POST" && p.endsWith("/heartbeat")) {
      const nodeId = p.split("/")[3];
      const body = await request.json().catch(() => ({}));
      const ex = await kv.get(`node:${nodeId}`);
      if (!ex) return J({ error: "node not registered" }, 404);
      const node = JSON.parse(ex);
      node.last_seen = Date.now(); node.heartbeats = (node.heartbeats || 0) + 1; node.status = "online";
      if (body.load !== undefined) node.load = body.load;
      if (body.mem !== undefined) node.mem = body.mem;
      await kv.put(`node:${nodeId}`, JSON.stringify(node));
      await kv.put(`node:${nodeId}:hb`, String(Date.now()), { expirationTtl: 3600 });
      return J({ status: "ok", node_id: nodeId, reputation: node.reputation });
    }
    if (p.startsWith("/api/nodes/") && method === "GET") {
      const nodeId = p.split("/")[3];
      const v = await kv.get(`node:${nodeId}`);
      if (!v) return J({ error: "node not found" }, 404);
      return J(JSON.parse(v));
    }

    // ============ API: CODE LAYER — Own GitHub (/api/repos) ============
    if (p === "/api/repos" && method === "GET") {
      const kl = await kv.list({ prefix: "repo:" });
      const names = new Set();
      for (const k of kl.keys) { const t = k.name.split(":"); if (t.length >= 3) names.add(t[1]); }
      return J(Array.from(names).map(n => ({ name: n })));
    }
    if (p === "/api/repos" && method === "POST") {
      const body = await request.json();
      const repo = body.name || body.repo;
      if (!repo) return J({ error: "repo name required" }, 400);
      const now = Date.now();
      const ex = await kv.get(`repo:${repo}:meta`);
      if (ex) return J({ error: "repo exists" }, 409);
      const meta = { name: repo, owner: body.owner || ORG, created: now, updated: now, description: body.description || "", private: !!body.private, stars: 0, head: "0000000000000000000000000000000000000000" };
      await kv.put(`repo:${repo}:meta`, JSON.stringify(meta));
      return J({ status: "created", repo: meta });
    }
    if (p.startsWith("/api/repos/")) {
      const rest = p.slice("/api/repos/".length).split("/");
      const repo = rest[0];
      if (rest.length === 1 && method === "GET") {
        const meta = await kv.get(`repo:${repo}:meta`);
        if (!meta) return J({ error: "repo not found" }, 404);
        const kl = await kv.list({ prefix: `repo:${repo}:blob:` });
        const tree = [];
        for (const k of kl.keys) { const v = await kv.get(k.name); if (v) { const b = JSON.parse(v); tree.push({ path: b.path, hash: b.hash, size: b.size, ts: b.ts }); } }
        return J({ repo: JSON.parse(meta), tree });
      }
      if (rest.length === 1 && method === "DELETE") {
        const kl = await kv.list({ prefix: `repo:${repo}:` });
        for (const k of kl.keys) await kv.delete(k.name);
        return J({ status: "deleted", repo });
      }
      if (rest[1] === "blob" && method === "PUT") {
        const content = await request.text();
        const filePath = rest.slice(2).join("/");
        if (!filePath) return J({ error: "path required" }, 400);
        const hash = await sha256(content);
        const branch = url.searchParams.get("branch") || "main";
        const now = Date.now();
        const metaKey = `repo:${repo}:meta`;
        const meta = JSON.parse(await kv.get(metaKey) || "null");
        if (!meta) return J({ error: "repo not found" }, 404);
        const blob = { path: filePath, content, hash, size: content.length, ts: now, branch, author: url.searchParams.get("author") || ORG };
        await kv.put(`repo:${repo}:blob:${filePath}`, JSON.stringify(blob));
        meta.updated = now; meta.head = hash;
        await kv.put(metaKey, JSON.stringify(meta));
        await kv.put(`repo:${repo}:commit:${now}:${hash}`, JSON.stringify({ hash, path: filePath, ts: now, message: url.searchParams.get("msg") || "update" }), { expirationTtl: 86400 * 30 });
        return J({ status: "committed", repo, path: filePath, hash, size: content.length });
      }
      if (rest[1] === "blob" && method === "GET") {
        const filePath = rest.slice(2).join("/");
        const v = await kv.get(`repo:${repo}:blob:${filePath}`);
        if (!v) return J({ error: "file not found" }, 404);
        return J(JSON.parse(v));
      }
      if (rest[1] === "commits" && method === "GET") {
        const kl = await kv.list({ prefix: `repo:${repo}:commit:` });
        const commits = [];
        for (const k of kl.keys) { const v = await kv.get(k.name); if (v) commits.push(JSON.parse(v)); }
        commits.sort((a, b) => b.ts - a.ts);
        return J({ repo, commits });
      }
    }

    // ============ API: MODEL LAYER — Own HuggingFace (/api/models) ============
    if (p === "/api/models" && method === "GET") {
      const kl = await kv.list({ prefix: "model:" });
      const models = [];
      for (const k of kl.keys) { if (k.name.endsWith(":card")) { const v = await kv.get(k.name); if (v) models.push(JSON.parse(v)); } }
      return J(models);
    }
    if (p === "/api/models" && method === "POST") {
      const body = await request.json();
      const id = body.id || body.name;
      if (!id) return J({ error: "model id required" }, 400);
      const now = Date.now();
      const ex = await kv.get(`model:${id}:card`);
      const card = {
        id, name: body.name || id, owner: body.owner || ORG, base: body.base || null,
        params: body.params || null, context: body.context || null, created: ex ? JSON.parse(ex).created : now,
        updated: now, downloads: ex ? JSON.parse(ex).downloads : 0, tags: body.tags || [],
        chunks: body.chunks || 0, api: body.api || `${SOVEREIGN_HS}/api/models/${id}/infer`
      };
      await kv.put(`model:${id}:card`, JSON.stringify(card));
      return J({ status: ex ? "updated" : "registered", model: card });
    }
    if (p.startsWith("/api/models/")) {
      const rest = p.slice("/api/models/".length).split("/");
      const id = rest[0];
      if (rest.length === 1 && method === "GET") {
        const card = await kv.get(`model:${id}:card`);
        if (!card) return J({ error: "model not found" }, 404);
        const c = JSON.parse(card);
        if (c.chunks > 0) {
          const kl = await kv.list({ prefix: `model:${id}:chunk:` });
          c.chunk_index = [];
          for (const k of kl.keys) c.chunk_index.push(k.name.split(":").pop());
        }
        return J(c);
      }
      if (rest[1] === "chunk" && method === "PUT") {
        const chunkContent = await request.text();
        const chunkId = url.searchParams.get("id") || String(Date.now());
        await kv.put(`model:${id}:chunk:${chunkId}`, chunkContent);
        const card = JSON.parse(await kv.get(`model:${id}:card`) || "{}");
        card.chunks = (card.chunks || 0) + 1; card.updated = Date.now();
        await kv.put(`model:${id}:card`, JSON.stringify(card));
        return J({ status: "chunk:stored", model: id, chunk: chunkId, size: chunkContent.length });
      }
      if (rest[1] === "chunk" && method === "GET") {
        const chunkId = url.searchParams.get("id");
        const v = await kv.get(`model:${id}:chunk:${chunkId}`);
        if (!v) return J({ error: "chunk not found" }, 404);
        return J({ model: id, chunk: chunkId, content: v });
      }
      if (rest[1] === "infer" && method === "POST") {
        const body = await request.json();
        const card = await kv.get(`model:${id}:card`);
        if (!card) return J({ error: "model not found" }, 404);
        const c = JSON.parse(card);
        c.downloads += 1; await kv.put(`model:${id}:card`, JSON.stringify(c));
        const backend = c.api;
        try {
          const resp = await fetch(backend, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          return J({ model: id, status: "inferred", backend, response: await resp.text() });
        } catch (e) {
          return J({ model: id, status: "inference_unavailable", error: e.message, backend }, 503);
        }
      }
    }

    // ============ API: COMPUTE LAYER — Own VPS (/api/compute) ============
    if (p === "/api/compute/dispatch" && method === "POST") {
      const body = await request.json();
      const task = { id: (body.id || `t-${Date.now()}`), type: body.type || "task", payload: body.payload || {}, created: Date.now(), status: "queued" };
      // round-robin: pick next node with 'compute' capability
      const kl = await kv.list({ prefix: "node:" });
      const candidates = [];
      for (const k of kl.keys) {
        if (k.name.endsWith(":hb")) continue;
        const v = await kv.get(k.name);
        if (!v) continue;
        const n = JSON.parse(v);
        if ((n.capabilities || []).includes("compute") && Date.now() - n.last_seen < 60000) candidates.push(n);
      }
      const idxKey = `rr:${task.type || "default"}`;
      const idx = parseInt(await kv.get(idxKey) || "0", 10);
      const target = candidates.length ? candidates[idx % candidates.length] : null;
      await kv.put(idxKey, String((idx + 1) % Math.max(candidates.length, 1)));
      if (!target) return J({ error: "no compute nodes online", task }, 503);
      await kv.put(`task:${task.id}`, JSON.stringify({ ...task, node_id: target.node_id, status: "dispatched", dispatched: Date.now() }));
      await kv.put(`node:${target.node_id}:task:${task.id}`, JSON.stringify(task));
      return J({ status: "dispatched", task, node: target.node_id });
    }
    if (p === "/api/compute/claim" && method === "POST") {
      const body = await request.json();
      const nodeId = body.node_id;
      if (!nodeId) return J({ error: "node_id required" }, 400);
      const kl = await kv.list({ prefix: `node:${nodeId}:task:` });
      const tasks = [];
      for (const k of kl.keys) { const v = await kv.get(k.name); if (v) tasks.push(JSON.parse(v)); }
      return J({ node_id: nodeId, tasks });
    }
    if (p === "/api/compute/complete" && method === "POST") {
      const body = await request.json();
      const task = await kv.get(`task:${body.task_id}`);
      if (!task) return J({ error: "task not found" }, 404);
      const t = JSON.parse(task);
      t.status = "done"; t.result = body.result; t.completed = Date.now();
      await kv.put(`task:${t.id}`, JSON.stringify(t));
      await kv.delete(`node:${t.node_id}:task:${t.id}`);
      return J({ status: "completed", task: t });
    }
    if (p === "/api/compute/status") {
      const taskId = url.searchParams.get("id");
      if (taskId) { const v = await kv.get(`task:${taskId}`); return v ? J(JSON.parse(v)) : J({ error: "task not found" }, 404); }
      const kl = await kv.list({ prefix: "task:" });
      const tasks = []; for (const k of kl.keys) { const v = await kv.get(k.name); if (v) tasks.push(JSON.parse(v)); }
      return J(tasks);
    }

    // ============ API: TRAINING LAYER — Own Data Centers (/api/training) ============
    if (p === "/api/training/jobs" && method === "GET") {
      const kl = await kv.list({ prefix: "train:" });
      const jobs = []; for (const k of kl.keys) { if (k.name.endsWith(":job")) { const v = await kv.get(k.name); if (v) jobs.push(JSON.parse(v)); } }
      return J(jobs);
    }
    if (p === "/api/training/jobs" && method === "POST") {
      const body = await request.json();
      const jobId = body.id || `tr-${Date.now()}`;
      const job = {
        id: jobId, name: body.name || jobId, model: body.model || null, dataset: body.dataset || null,
        status: "queued", progress: 0, total_steps: body.total_steps || 100, current_step: 0,
        workers: [], losses: [], created: Date.now(), updated: Date.now(), hyperparams: body.hyperparams || {}
      };
      await kv.put(`train:${jobId}:job`, JSON.stringify(job));
      return J({ status: "job:created", job });
    }
    if (p.startsWith("/api/training/jobs/")) {
      const jobId = p.split("/")[4];
      const key = `train:${jobId}:job`;
      const ex = await kv.get(key);
      if (!ex) return J({ error: "job not found" }, 404);
      const job = JSON.parse(ex);
      if (method === "GET") return J(job);
      if (method === "POST") {
        const body = await request.json();
        if (body.worker) {
          if (!job.workers.includes(body.worker)) job.workers.push(body.worker);
          if (body.loss !== undefined) { job.losses.push({ step: body.step ?? job.current_step, loss: body.loss, worker: body.worker, ts: Date.now() }); job.losses = job.losses.slice(-200); }
          if (body.step !== undefined) job.current_step = Math.max(job.current_step, body.step);
        }
        job.progress = Math.round((job.current_step / job.total_steps) * 100);
        job.status = job.progress >= 100 ? "done" : "training";
        job.updated = Date.now();
        if (body.done) { job.status = "done"; job.progress = 100; job.finished = Date.now(); }
        await kv.put(key, JSON.stringify(job));
        return J({ status: "job:updated", job });
      }
    }
    if (p === "/api/training/datasets" && method === "POST") {
      const body = await request.json();
      const ds = { id: body.id, name: body.name || body.id, owner: body.owner || ORG, samples: 0, created: Date.now(), tags: body.tags || [] };
      await kv.put(`train:${ds.id}:dataset`, JSON.stringify(ds));
      return J({ status: "dataset:created", dataset: ds });
    }

    // ============ INFRA LAYERS (mesh / dns / store) — kept for daemons ============
    if (p.startsWith("/mesh/")) {
      const nodeId = url.searchParams.get("node_id") || "default";
      const id = env.MESH_NODES.idFromName(`mesh-${nodeId}`);
      return env.MESH_NODES.get(id).fetch(new Request(`${url.origin}${p.replace("/mesh", "")}?node_id=${nodeId}`, request));
    }
    if (p.startsWith("/dns/")) {
      const kv2 = env.DNS_ZONE || kv;
      if (p.startsWith("/dns/resolve/")) {
        const name = p.split("/dns/resolve/")[1].replace(".eon-mesh.internal", "").toLowerCase();
        let record = { brain: { type: "onion", url: `${SOVEREIGN_HS}/brain` }, git: { type: "onion", url: `${SOVEREIGN_HS}/git` }, models: { type: "onion", url: `${SOVEREIGN_HS}/models` }, compute: { type: "onion", url: `${SOVEREIGN_HS}/compute` }, train: { type: "onion", url: `${SOVEREIGN_HS}/train` }, mesh: { type: "onion", url: SOVEREIGN_HS }, node5: { type: "onion", url: SOVEREIGN_HS } }[name];
        if (!record) { const custom = await kv2.get(`dns:${name}`); if (custom) record = JSON.parse(custom); }
        return J({ name: `${name}.eon-mesh.internal`, resolved: record || { type: "unresolved", url: "" } });
      }
      if (method === "POST" && p === "/dns/set") {
        const body = await request.json();
        await kv2.put(`dns:${body.name.replace(".eon-mesh.internal", "").toLowerCase()}`, JSON.stringify(body.record), { expirationTtl: body.ttl || 86400 });
        return J({ status: "dns:set" });
      }
      if (p === "/dns/list") {
        const kl = await kv2.list({ prefix: "dns:" });
        const records = {};
        for (const k of kl.keys) { const v = await kv2.get(k.name); if (v) records[k.name.replace("dns:", "")] = JSON.parse(v); }
        return J({ records, count: Object.keys(records).length });
      }
    }
    if (p.startsWith("/store/")) {
      const key = p.split("/store/")[1];
      if (method === "PUT") {
        const body = await request.text();
        const nodeId = request.headers.get("X-Node-Id") || "unknown";
        const ts = Date.now();
        await kv.put(`data:${key}`, body, { metadata: { node_id: nodeId, timestamp: ts, content_type: request.headers.get("Content-Type") || "octet" } });
        return J({ status: "stored", key, node_id: nodeId, timestamp: ts });
      }
      if (method === "GET") {
        const r = await kv.getWithMetadata(`data:${key}`);
        if (!r || r.value === null) return new Response("Not Found", { status: 404, headers: cors });
        return J({ key, value: r.value, metadata: r.metadata || {} });
      }
      if (method === "DELETE") { await kv.delete(`data:${key}`); return J({ status: "deleted", key }); }
    }
    if (p === "/list") {
      const prefix = url.searchParams.get("prefix") || "";
      const kl = await kv.list({ prefix });
      return J({ keys: kl.keys.map(k => k.name), count: kl.keys.length });
    }

    return J({ service: "eon-neural-web", version: "4.0", organs: ["identity", "git", "models", "compute", "training"], layers: LAYERS, node: ORG, mesh: SOVEREIGN_HS });
  }
};

function dashboard(env, kv) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EON Neural Web</title>
<style>
:root{--bg:#0b0f1a;--card:#141a2e;--line:#232c46;--tx:#d7e0ff;--dim:#7c89b8;--ac:#4d7cfe;--ok:#2ecc71;--war:#f39c12;--bad:#e74c3c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:24px}
h1{font-size:22px;margin:0 0 4px;letter-spacing:.5px}h1 .dot{color:var(--ok)}h2{font-size:14px;color:var(--ac);text-transform:uppercase;letter-spacing:1px;margin:0 0 12px}
.sub{color:var(--dim);margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.card h3{margin:0 0 10px;font-size:13px;color:var(--dim);font-weight:600}.row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #1c2340}
.row:last-child{border-bottom:none}.k{color:var(--dim)}.v{color:var(--tx);max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11px;font-weight:700}
.b-ok{background:#0f2a1a;color:var(--ok)}.b-dim{background:#1c2340;color:var(--dim)}.b-war{background:#2a220f;color:var(--war)}
.layers{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.chip{background:#0f1526;border:1px solid var(--line);border-radius:20px;padding:2px 10px;font-size:11px;color:var(--ac)}
#clock{color:var(--dim);font-size:12px;float:right}footer{margin-top:24px;color:var(--dim);font-size:11px}
</style></head><body>
<h1><span class="dot">●</span> EON NEURAL WEB</h1>
<p class="sub">Parallel Internet OS · Own GitHub · Own HuggingFace · Own VPS · Own Data Centers · Sovereign Identity<br>
Mesh: <span style="color:var(--ac)">${SOVEREIGN_HS}</span></p>
<div class="grid">
<div class="card"><h3>HEALTH</h3><div id="health"><div class="row"><span class="k">loading</span></div></div></div>
<div class="card"><h3>NODES <span class="badge b-dim" id="ncount">0</span></h3><div id="nodes"><div class="row"><span class="k">loading</span></div></div></div>
<div class="card"><h3>REPOS (Own GitHub)</h3><div id="repos"><div class="row"><span class="k">loading</span></div></div></div>
<div class="card"><h3>MODELS (Own HuggingFace)</h3><div id="models"><div class="row"><span class="k">loading</span></div></div></div>
<div class="card"><h3>COMPUTE TASKS (Own VPS)</h3><div id="tasks"><div class="row"><span class="k">loading</span></div></div></div>
<div class="card"><h3>TRAINING JOBS (Own Data Centers)</h3><div id="train"><div class="row"><span class="k">loading</span></div></div></div>
</div>
<footer>EON Neural Web v4.0 · KV design: 100k reads / 1k writes per day · writes coalesced · sovereign via Tor HSv3</footer>
<script>
const q=(s,o={})=>fetch(s,o).then(r=>r.json()).catch(e=>({error:String(e)}));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function rows(items,cols){return (items.length?items:[]).map(i=>cols.map(c=>'<span class="k">'+esc(c[0])+':</span><span class="v">'+esc(i[c[1]])+'</span>').join('')).join('<div class="row">')+'</div>'.repeat(Math.max(items.length,1));}
async function load(){
const [h,n,r,m,t,tr]=await Promise.all([q('/api/health'),q('/api/nodes'),q('/api/repos'),q('/api/models'),q('/api/compute/status'),q('/api/training/jobs')]);
document.getElementById('health').innerHTML='<div class="row"><span class="k">status</span><span class="v"><span class="badge b-ok">'+esc(h.status)+'</span></span></div><div class="row"><span class="k">version</span><span class="v">'+esc(h.version)+'</span></div><div class="row"><span class="k">organs</span><span class="v">'+esc(h.organ_count)+'</span></div>';
const nn=(n.error||[]);document.getElementById('ncount').textContent=nn.length;
document.getElementById('nodes').innerHTML=rows(nn,[['node_id','node_id'],['addr','addr'],['reputation','reputation']])||'<div class="row"><span class="k">none</span></div>';
const rr=(r.error||[]);document.getElementById('repos').innerHTML=rows(rr,[['name','name']])||'<div class="row"><span class="k">none</span></div>';
const mm=(m.error||[]);document.getElementById('models').innerHTML=rows(mm,[['id','id'],['params','params'],['downloads','downloads']])||'<div class="row"><span class="k">none</span></div>';
const tt=(t.error||[]);document.getElementById('tasks').innerHTML=rows(tt,[['id','id'],['type','type'],['status','status']])||'<div class="row"><span class="k">none</span></div>';
const trr=(tr.error||[]);document.getElementById('train').innerHTML=rows(trr,[['id','id'],['status','status'],['progress','progress']])||'<div class="row"><span class="k">none</span></div>';
}
load();setInterval(load,10000);
</script></body></html>`;
}
