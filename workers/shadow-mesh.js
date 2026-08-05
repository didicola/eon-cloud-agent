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
const round3 = (x) => Math.round(x * 1000) / 1000;

// ============ TRIGONOMETRIC ROUND MATRIX — pure-math routing (all-in-cloud) ============
// sin/cos/tan/log1p routing so the mesh routes like a quantum-ghost neuro-organ, in light
// of speed. Phase advances per dispatch; nodes scored by a bounded sticky cosine weight,
// a sin load-balance sweet spot (50% capacity), a log1p topology-compression distance term,
// and a tan slope tie-break ("heating up" nodes). Circular bridges emit a ghost hop node.
const TRIG_PHASE = {};          // type -> advancing phase
const TRIG_HOPS = [];           // recent ghost-hop log
const TRIG_LOG = {};            // type -> {last: {node, phase, cos, sin, tan, log1p, score}}

function trigRoundWeight(phase) { return Math.max(0, Math.min(2, Math.cos(phase))); }          // [0,2]
function trigSlope(phase) { const t = Math.tan(phase); return Number.isFinite(t) && t > 0 ? Math.min(t, 10) : 0; }
function trigLoadWeight(load) { const v = Math.sin(Math.PI * Math.max(0, Math.min(1, load || 0))); return Math.max(0, v); } // 1 at 50%
function trigDistWeight(ageSec) { return 1 / (1 + Math.log1p(Math.max(ageSec, 0) + 1)); }       // local first

function trigScore(node, phase) {
  const load = node.load ?? 0;
  const ageSec = (Date.now() - (node.last_seen || Date.now())) / 1000;
  const cos = trigRoundWeight(phase);
  const sin = trigLoadWeight(load);
  const d = trigDistWeight(ageSec);
  // weighted sum: bounded sticky (0.4) + load sweet-spot (0.35) + local topology (0.25)
  const score = 0.4 * cos + 0.35 * sin + 0.25 * d;
  return { score, cos, sin, tan: trigSlope(phase), d };
}

function trigPick(pool, type) {
  if (!pool || !pool.length) return null;
  const phase = (TRIG_PHASE[type] || 0) + 0.7; // advance ~40deg each dispatch
  TRIG_PHASE[type] = phase;
  let best = null, bestS = null, tie = 0;
  for (const node of pool) {
    const s = trigScore(node, phase);
    if (!best || s.score > bestS.score + 1e-9 || (Math.abs(s.score - bestS.score) < 1e-9 && s.tan > bestS.tan)) {
      best = node; bestS = s; tie++;
    }
  }
  if (best) {
    TRIG_LOG[type] = { node: best.node_id, phase: round3(phase), cos: round3(bestS.cos), sin: round3(bestS.sin), tan: round3(bestS.tan), d: round3(bestS.d), score: round3(bestS.score) };
    // Circular bridge: a ghost hop on the semicircle between mesh and target (A->ghost->B).
    TRIG_HOPS.push({ type, node: best.node_id, ghost: `ghost-${type}-${Math.round(phase * 57.2958) % 360}`, phase: round3(phase), ts: Date.now() });
    if (TRIG_HOPS.length > 50) TRIG_HOPS.shift();
  }
  return best;
}
function trigState() { return { phases: TRIG_PHASE, last: TRIG_LOG, ghost_hops: TRIG_HOPS.slice(-10) }; }

// SOVEREIGN ACCESS GATE — HMAC token. If EON_ACCESS_TOKEN is set, every mutating route
// must present Authorization: Bearer eon:<token>. Internal agents pass the same env token.
// When unset (dev/onion-loop), writes stay open for backward-compat single-node use.
const ACCESS_TOKEN = process.env.EON_ACCESS_TOKEN || "";
const gate = (request) => {
  if (!ACCESS_TOKEN) return true;
  const h = request.headers.get("Authorization") || "";
  const want = h.startsWith("Bearer ") ? h.slice(7) : h;
  return want === ACCESS_TOKEN;
};
const MUTATING = [
  "replica/apply", "replica/trim", "memory/decay", "memory/feedback", "memory/episodic",
  "fluid", "collapse", "compute/dispatch", "compute/claim", "compute/complete", "nodes",
  "training/jobs", "benchmark/results", "models", "repos", "learn",
  "ml/run", "ml/complete", "ml/version",
];

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
    // SOVEREIGN GATE: mutating routes require the token when configured.
    const api = path.split("/api/")[1] || "";
    if (method !== "GET" && method !== "HEAD" && ACCESS_TOKEN && MUTATING.some(m => api.startsWith(m))) {
      if (!gate(request)) return J({ error: "unauthorized: missing/invalid bearer token" }, 401);
    }
    const kv = env.NEURAL_KV || env.SWARM_KV;
    const p = path.replace(/\/+$/, "");
    const [s1, s2, s3] = p.split("/").filter(Boolean);

    // ============ ROOT: LIVE HTML DASHBOARD ============
    if (p === "" || p === "/") return T(dashboard(env, kv));

    // ============ BIO-AI BENCHMARK DASHBOARD (/benchmark) ============
    if (p === "/benchmark") return T(benchmarkPage(env, kv));

    // ============ API: HEALTH ============
    if (p === "/api/health") {
      return J({ status: "ok", service: "eon-neural-web", version: "4.0", organ_count: 5, node: ORG, mesh: SOVEREIGN_HS, uptime: Date.now() });
    }

    // ============ API: COSMIC PULSE — observer-effect mesh beacon (all-own, no external) ============
    if (p === "/api/cosmic-pulse") {
      const list = await kv.list({ prefix: "node:" });
      const nodes = [];
      for (const k of list.keys) {
        const segs = k.name.split(":");
        if (segs.length !== 2) continue;
        const v = await kv.get(k.name); if (v) nodes.push(v);
      }
      const mem = await kv.list({ prefix: "mem:" });
      return J({
        status: "online", pulse: Date.now(), node: ORG, mesh: SOVEREIGN_HS,
        nodes_observed: nodes.length,
        memory_episodes: mem.keys.length,
        organ: "hippocampus+cortex",
      });
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
      // GPU-aware dispatch: heavy/deep-learning types (snn, train, embed, dl) prefer nodes
      // advertising a 'gpu' capability so the day a GPU box joins, training runs there.
      // CPU-only nodes handle light types (infer, task) via round-robin.
      const GW = (task.type in { snn:1, train:1, embed:1, dl:1, deep:1 }) ? true : false;
      const kl = await kv.list({ prefix: "node:" });
      const candidates = [];
      for (const k of kl.keys) {
        if (k.name.endsWith(":hb")) continue;
        const v = await kv.get(k.name);
        if (!v) continue;
        const n = JSON.parse(v);
        if ((n.capabilities || []).includes("compute") && Date.now() - n.last_seen < 60000) candidates.push(n);
      }
      const online = candidates;
      const pool = GW ? (online.filter(n => (n.capabilities || []).includes("gpu")).length ? online.filter(n => (n.capabilities || []).includes("gpu")) : online) : online;
      // TRIGONOMETRIC ROUND MATRIX: cos-bound sticky + sin load sweet-spot + log1p distance +
      // tan slope tie-break pick the target, emitting a ghost hop. Falls back to RR if empty.
      const target = trigPick(pool, task.type || "default");
      await kv.put(`rr:${task.type || "default"}`, String(Date.now()));
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
    if (p === "/api/compute/trig") {
      // Trigonometric Round Matrix state: phases, last trig decision per type, ghost hops.
      return J({ service: "eon-trigonometric-round-matrix", routing: "cos+sin+tan+log1p", ...trigState() });
    }

    // ============ API: CLOUD-TORCH SERVERLESS ML GATEWAY (/api/ml/*) ============
    // Local thin clients (cloud_torch.py) never import torch; they POST code+data here,
    // poll /api/ml/status/:id, and cloud runners (Colab/Kaggle/GitHub) webhook back
    // to /api/ml/complete. Provider auto-rotation: colab -> kaggle -> github(CPU) -> queue.
    if (p === "/api/ml/run" && method === "POST") {
      const body = await request.json();
      const task = { id: `ml-${Date.now()}`, status: "queued", created: Date.now(),
                     framework: body.framework || "torch", gpu: !!body.gpu,
                     provider: body.provider || "auto", code: body.code || "", data: body.data || {} };
      const ORDER = ["colab", "kaggle", "github"];
      task.provider = task.provider === "auto" ? ORDER[0] : task.provider;
      task.provider_chain = ORDER;
      await kv.put(`mltask:${task.id}`, JSON.stringify(task));
      return J({ status: "queued", task_id: task.id, provider: task.provider, poll: `/api/ml/status/${task.id}` });
    }
    if (p.startsWith("/api/ml/status/") && method === "GET") {
      const id = p.split("/").pop();
      const v = await kv.get(`mltask:${id}`);
      return v ? J(JSON.parse(v)) : J({ error: "task not found" }, 404);
    }
    if (p === "/api/ml/tasks" && method === "GET") {
      const kl = await kv.list({ prefix: "mltask:" });
      const tasks = []; for (const k of kl.keys) { const v = await kv.get(k.name); if (v) tasks.push(JSON.parse(v)); }
      return J({ status: "ok", tasks, count: tasks.length });
    }
    if (p.startsWith("/api/ml/job/") && method === "GET") {
      // Runner pull: returns a queued job (oldest-first for "latest") and claims it.
      // Claimed/done jobs return their current status; only an empty queue is a 404.
      const id = p.split("/").pop();
      const claim = async (raw, key) => {
        const t = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (t && t.status === "queued") {
          t.status = "claimed"; t.claimed = Date.now();
          await kv.put(key, JSON.stringify(t));
        }
        return t;
      };
      if (id === "latest") {
        const kl = await kv.list({ prefix: "mltask:" });
        const queued = [];
        for (const k of kl.keys) {
          const v = await kv.get(k.name);
          if (!v) continue;
          const t = typeof v === "string" ? JSON.parse(v) : v;
          if (t && t.status === "queued") queued.push(t);
        }
        queued.sort((a, b) => (a.created || 0) - (b.created || 0) || String(a.id).localeCompare(String(b.id)));
        if (!queued.length) return J({ error: "no queued jobs" }, 404);
        const job = await claim(queued[0], `mltask:${queued[0].id}`);
        return J({ task_id: job.id, code: job.code, data: job.data, framework: job.framework, gpu: job.gpu, provider_chain: job.provider_chain, status: job.status });
      }
      const v = await kv.get(`mltask:${id}`);
      if (!v) return J({ error: "task not found" }, 404);
      const t = await claim(v, `mltask:${id}`);
      return J({ task_id: t.id, code: t.code, data: t.data, framework: t.framework, gpu: t.gpu, provider_chain: t.provider_chain, status: t.status });
    }
    if (p === "/api/ml/complete" && method === "POST") {
      const body = await request.json();
      const v = await kv.get(`mltask:${body.task_id}`);
      if (!v) return J({ error: "task not found" }, 404);
      const t = JSON.parse(v);
      t.status = body.status || "done"; t.result = body.result || {}; t.completed = Date.now();
      t.provider_used = body.provider || t.provider;
      await kv.put(`mltask:${t.id}`, JSON.stringify(t));
      // PROMOTION side-effects: persist weights -> model:weights:<version>, bump the
      // model:active_version source of truth, and mirror durably to disk (big weights).
      // Fully wrapped so a weights-format error can never break the completion response.
      try {
        const r = t.result || {};
        const w = Array.isArray(r.weights) ? r.weights : (r.weights && Array.isArray(r.weights.weights) ? r.weights.weights : null);
        if (w) {
          const cur = await kv.get("model:active_version");
          const bump = (ver) => {
            if (/^v\d+(\.\d+)*$/.test(ver)) {
              const parts = ver.slice(1).split(".").map(Number);
              parts[parts.length - 1] += 1;
              return "v" + parts.join(".");
            }
            if (/^\d+$/.test(ver)) return String(Number(ver) + 1);
            return "v0.1";
          };
          const version = r.version || (cur ? bump(cur) : "v0.1");
          const wr = await kv.put(`model:weights:${version}`, JSON.stringify(w));
          if (wr && wr.oversized) console.warn(`[ml] weights oversized for KV (${wr.size}B > ${process.env.EON_KV_MAX_VALUE || 65536}B) — mirror only`);
          await kv.put("model:active_version", version);
          const { mkdirSync, writeFileSync } = await import("node:fs");
          const dir = "/root/eon-cloud-agent/state/models";
          mkdirSync(dir, { recursive: true });
          writeFileSync(`${dir}/${version}.json`, JSON.stringify({ version, ts: Date.now(), metrics: r.metrics || {}, weights: w, provider: t.provider_used }));
          console.log(`[ml] promoted version ${version} (${t.provider_used})`);
        }
      } catch (e) {
        console.error("[ml] promotion failed", e.message);
      }
      return J({ status: "completed", task: t });
    }
    if (p === "/api/ml/version" && method === "GET") {
      const v = await kv.get("model:active_version");
      return J({ active_version: v || "" });
    }
    if (p === "/api/ml/version" && method === "POST") {
      const body = await request.json();
      await kv.put("model:active_version", body.version || "");
      return J({ status: "set", active_version: body.version || "" });
    }

    // ============ API: THEORETICAL PHYSICS ENGINE (/api/physics/*) ============
    // Ghost Atom (QFT), Imaginary Time (blank time), Hawking Radiation, String
    // Compactification (steganography). Heavy compute runs on cloud VMs via the
    // venv python modules; the worker exposes the routing/status surface.
    if (p === "/api/physics/ghost" && method === "POST") {
      const body = await request.json();
      const target = body.target || "http://127.0.0.1:8787/api/compute/trig";
      const nth = Number(body.nth || 7);
      try {
        const { execFile } = await import("node:child_process");
        const py = "/root/eon-cloud-agent/venv/bin/python";
        const res = await new Promise((ok) => execFile(py, ["/root/eon-cloud-agent/workers/ghost_atom.py", "--payload", JSON.stringify(body.payload || { x: 1 }), "--target", target, "--nth", String(nth)], { timeout: 15000 }, (e, so) => ok(e ? { error: e.message } : JSON.parse(so.trim().split("\n").pop()))));
        return J({ service: "ghost-atom", nth, target, ...res });
      } catch (e) { return J({ service: "ghost-atom", error: e.message }, 500); }
    }
    if (p === "/api/physics/imaginary" && method === "POST") {
      const body = await request.json();
      const taskId = body.task_id || `t-${Date.now()}`;
      const { execFile } = await import("node:child_process");
      const py = "/root/eon-cloud-agent/venv/bin/python";
      const res = await new Promise((ok) => execFile(py, ["/root/eon-cloud-agent/workers/imaginary_time_queue.py", "--push", "--id", taskId, "--payload", JSON.stringify(body.payload || {})], { timeout: 10000 }, (e, so) => ok(e ? { error: e.message } : JSON.parse(so.trim().split("\n").pop()))));
      return J({ service: "imaginary-time", ...res });
    }
    if (p === "/api/physics/imaginary/drain" && method === "GET") {
      const { execFile } = await import("node:child_process");
      const py = "/root/eon-cloud-agent/venv/bin/python";
      const res = await new Promise((ok) => execFile(py, ["/root/eon-cloud-agent/workers/imaginary_time_queue.py", "--process"], { timeout: 15000 }, (e, so) => { if (e) return ok({ error: e.message }); try { return ok(JSON.parse(so)); } catch { return ok({ drained: so.trim() }); } }));
      return J({ service: "imaginary-time", ...res });
    }
    if (p === "/api/physics/hawking" && method === "POST") {
      const { execFile } = await import("node:child_process");
      const py = "/root/eon-cloud-agent/venv/bin/python";
      const res = await new Promise((ok) => execFile(py, ["/root/eon-cloud-agent/workers/hawking_daemon.py", "--once"], { timeout: 30000 }, (e, so) => { if (e) return ok({ error: e.message }); try { return ok(JSON.parse(so)); } catch { return ok({ scanned: so.trim() }); } }));
      return J({ service: "hawking-radiation", ...res });
    }
    if (p === "/api/physics/string/encode" && method === "POST") {
      const body = await request.json();
      const path = `/tmp/compact_${Date.now()}.png`;
      const { execFile } = await import("node:child_process");
      const py = "/root/eon-cloud-agent/venv/bin/python";
      const res = await new Promise((ok) => execFile(py, ["/root/eon-cloud-agent/workers/string_compact.py", "--encode", JSON.stringify(body.payload || {}), "--out", path], { timeout: 30000 }, (e, so) => ok(e ? { error: e.message } : { ok: true, path, raw: so.trim().slice(0, 200) })));
      return J({ service: "string-compact", ...res });
    }
    if (p === "/api/physics/string/decode" && method === "POST") {
      const body = await request.json();
      const { execFile } = await import("node:child_process");
      const py = "/root/eon-cloud-agent/venv/bin/python";
      const res = await new Promise((ok) => execFile(py, ["/root/eon-cloud-agent/workers/string_compact.py", "--decode", "--path", body.path || "/tmp/compact.png"], { timeout: 30000 }, (e, so) => ok(e ? { error: e.message } : JSON.parse(so.trim().split("\n").pop()))));
      return J({ service: "string-compact", ...res });
    }

    // ============ API: MESH REPLICATION — second-node CRDT sync over Tor ============
    // Twin nodes dial the primary onion and pull a full snapshot, then subscribe
    // to the incremental journal. The onion host stays the canonical source of truth.
    if (p === "/api/replica/snapshot" && method === "GET") {
      const kl = await kv.list({ prefix: "" });
      const data = {};
      for (const k of kl.keys) { const v = await kv.get(k.name); if (v !== null) data[k.name] = v; }
      return J({ status: "snapshot", ts: Date.now(), keys: Object.keys(data).length, data });
    }
    if (p === "/api/replica/journal" && method === "GET") {
      const since = parseInt(url.searchParams.get("since") || "0", 10);
      const kl = await kv.list({ prefix: "" });
      const entries = [];
      for (const k of kl.keys) { const v = await kv.getWithMetadata(k.name); if (v.value !== null && (v.ts || v.metadata?.ts || 0) >= since) entries.push({ key: k.name, value: v.value, ts: v.ts || v.metadata?.ts || 0 }); }
      return J({ status: "journal", since, ts: Date.now(), entries: entries.length, data: entries });
    }
    if (p === "/api/replica/apply" && method === "POST") {
      // twin -> primary: submit locally-created records (CRDT-style: last-write-wins by ts).
      // SOVEREIGN: unwrap a transport envelope ({v,...}) exactly once before put so the
      // snapshot_daemon re-apply loop cannot re-nest envelopes (the bug that ballooned
      // task/train blobs to 407KB and killed replica sync).
      const body = await request.json();
      const applied = [];
      const unwrap = (v) => {
        if (typeof v === "string") { try { const p = JSON.parse(v); if (p && typeof p === "object" && "v" in p) return p.v; } catch {} }
        else if (v && typeof v === "object" && "v" in v && !("result" in v)) return v.v;
        return v;
      };
      for (const rec of body.records || []) {
        const ex = await kv.getWithMetadata(rec.key);
        if (!ex.value || (ex.metadata?.ts || 0) < (rec.ts || 0)) {
          await kv.put(rec.key, unwrap(rec.value), { metadata: { ts: rec.ts || Date.now() } });
          applied.push(rec.key);
        }
      }
      return J({ status: "applied", applied: applied.length, keys: applied });
    }
    // SOVEREIGN TRIM: purge oversized/oversized/malformed values that violate the KV blob
    // budget, so replica sync stops copying megabytes. Keeps the sovereign store lean.
    if (p === "/api/replica/trim" && method === "POST") {
      const body = await request.json();
      const budget = Number(body.max_size || 65536);
      const kl = await kv.list({ prefix: "" });
      const removed = [];
      let kept = 0;
      for (const k of kl.keys) {
        const v = await kv.getWithMetadata(k.name);
        if (v.value === null) continue;
        let size = 0; try { size = Buffer.byteLength(JSON.stringify(v.value)); } catch {}
        if (size > budget) { await kv.delete(k.name); removed.push({ key: k.name, size }); } else kept++;
      }
      return J({ status: "trimmed", budget, removed: removed.length, kept, keys: removed });
    }


    // ============ API: BIO-AI BENCHMARK — Sovereign SNN vs LLM vs Human ============
    // Results stored in the sovereign KV (all-in-cloud); benchmark_runner.py POSTs them.
    // ============ API: FLUID BRIDGE — Matrix Processor routing layer ============
    if (p === "/api/fluid" && method === "POST") {
      const body = await request.json();
      try {
        const resp = await fetch(`http://127.0.0.1:${process.env.EON_FLUID_PORT || 8401}`,
                                 { method: "POST", headers: { "Content-Type": "application/json" },
                                   body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
        return J(await resp.json());
      } catch (e) {
        return J({ track: "llm", prompt: body.prompt, response: "fluid bridge offline",
                   error: e.message }, 503);
      }
    }

    // ============ API: HIPPOCAMPUS — episodic + emotional memory (sovereign) ============
    // Cortex recall (fluid_bridge) queries this before routing: "what worked before?"
    // Episodes stored in the sovereign KV; emotional_weight drives recall priority.
    if (p === "/api/memory/episodic" && method === "POST") {
      const body = await request.json();
      const ts = body.ts || Date.now();
      const id = `mem:${ts}:${(body.id || Math.random().toString(36).slice(2, 7))}`;
      const episode = {
        id, text: body.text || body.prompt || "", tag: body.tag || "general",
        emotional_weight: Number(body.emotional_weight || 0),
        outcome: body.outcome || "neutral", ts, stored: Date.now()
      };
      await kv.put(id, episode);
      return J({ status: "memorized", id, episode });
    }
    if (p === "/api/memory/recall" && method === "GET") {
      const tag = url.searchParams.get("tag");
      const top = parseInt(url.searchParams.get("top") || "20", 10);
      const kl = await kv.list({ prefix: "mem:" });
      const eps = [];
      for (const k of kl.keys) {
        const v = await kv.get(k.name);
        if (v && typeof v === "object" && v.text) {
          if (tag && v.tag !== tag) continue;
          eps.push(v);
        }
      }
      eps.sort((a, b) => (b.emotional_weight || 0) - (a.emotional_weight || 0) || (b.ts - a.ts));
      return J(eps.slice(0, top));
    }
    if (p === "/api/memory/feedback" && method === "POST") {
      const body = await request.json();
      const id = body.id || "";
      const rec = await kv.get(id);
      if (!rec || typeof rec !== "object") return J({ error: "episode not found" }, 404);
      const delta = body.ok ? 1 : -1;
      rec.emotional_weight = (rec.emotional_weight || 0) + delta;
      rec.outcome = body.ok ? "success" : "failure";
      rec.updated = Date.now();
      await kv.put(id, rec);
      return J({ status: "feedback-applied", id, emotional_weight: rec.emotional_weight });
    }
    if (p === "/api/memory" && method === "GET") {
      const kl = await kv.list({ prefix: "mem:" });
      const eps = [];
      for (const k of kl.keys) { const v = await kv.get(k.name); if (v && typeof v === "object" && v.text) eps.push(v); }
      eps.sort((a, b) => (b.emotional_weight || 0) - (a.emotional_weight || 0) || (b.ts - a.ts));
      return J({ status: "hippocampus", count: eps.length, episodes: eps });
    }
    if (p === "/api/memory/decay" && method === "POST") {
      // Entropy Daemon: age-out useless memories. Emotional weight decays toward 0 with age;
      // episodes past max_age_days with weight <= 0 (or below threshold) are forgotten, keeping
      // the state-space from expanding into chaos. Sovereign, full in KV.
      const body = await request.json();
      const now = Date.now();
      const maxAgeMs = (body.max_age_days ?? 30) * 86400000;
      const threshold = body.threshold ?? 0;
      const decay = Number(body.decay || 0); // per-call weight decay applied to survivors
      const kl = await kv.list({ prefix: "mem:" });
      let removed = 0, kept = 0, decayed = 0;
      for (const k of kl.keys) {
        const v = await kv.get(k.name);
        if (!v || typeof v !== "object" || !v.text) continue;
        const age = now - (v.ts || v.stored || 0);
        const tooOld = age > maxAgeMs;
        const weak = (v.emotional_weight || 0) < threshold;
        if (tooOld && weak) {
          await kv.delete(k.name); removed++;
        } else {
          if (decay !== 0) { v.emotional_weight = Math.round(((v.emotional_weight || 0) - decay) * 1000) / 1000; await kv.put(k.name, v); decayed++; }
          kept++;
        }
      }
      return J({ status: "entropy-applied", scan: "mem:", removed, kept, decayed,
                 max_age_days: body.max_age_days ?? 30, decay });
    }

    if (p === "/api/collapse" && method === "POST") {
      // Multiverse collapse: branch a prompt across the sovereign mesh (base region + any
      // spawned sub-spaces/brain regions), then collide into a consensus verdict.
      const body = await request.json();
      const prompt = body.prompt || "";
      const mem = await kv.list({ prefix: "mem:" });
      let memoryHits = 0;
      for (const k of mem.keys) {
        const v = await kv.get(k.name);
        if (v && typeof v === "object" && v.text && prompt && v.text.split(" ").some(w => prompt.toLowerCase().includes(String(w).toLowerCase().slice(0, 12)) && String(w).length > 4)) memoryHits++;
      }
      const llmOut = await fetch(`http://127.0.0.1:${process.env.EON_FLUID_PORT || 8401}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(45000) })
        .then(r => r.json()).catch(() => ({}));
      const track = llmOut.track || "llm";
      // Branch across spawned brain sub-spaces too (each is a registered region w/ own memory).
      const sp = await kv.list({ prefix: "space:" });
      const spaces = [];
      for (const k of sp.keys) {
        const raw = await kv.get(k.name);
        if (!raw) continue;
        const v = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (v && v.region) spaces.push(v);
      }
      const parallel = spaces.map(s => ({
        region: s.region, scope: s.scope, branch: s.branch || "reflective",
        verdict: `[${s.region}] interpreting "${prompt}"`,
      }));
      return J({
        status: "collapsed", prompt,
        memory_prior: memoryHits,
        track, branch: { llm: !!llmOut.response, snn: track === "snn", spaces: spaces.length },
        spaces, response: llmOut.response || llmOut.note || "no verdict",
      });
    }

    if (p === "/api/spaces" && method === "POST") {
      // CREATE A NEW SUB-SPACE (new brain region). Registers it as a node with its own
      // identity, DNS alias, and dedicated memory namespace so it can think independently
      // and be consulted by /api/collapse. All-in-cloud: lives in sovereign KV + own DNS.
      const body = await request.json();
      const region = (body.region || "sub-brain").toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const id = `space-${region}`;
      const v = await kv.get(`space:${id}`);
      if (v) return J({ status: "exists", space: v });
      const rec = {
        id, region, scope: body.scope || "reasoning",
        branch: body.branch || "reflective",
        prompt_template: body.prompt_template || `You are a specialized EON brain region "${region}". Consider: `,
        created: Date.now(), status: "spawned",
        node_id: `${id}-node`, capabilities: ["compute"],
        memory_ns: `space:${id}:mem`, dns: `${region}.eon-mesh.internal`,
      };
      await kv.put(`space:${id}`, JSON.stringify(rec));
      const dns = await kv.put(`dns:${region}`, JSON.stringify({ record: { type: "onion", url: "" }, ttl: 86400 }));
      return J({ status: "space:spawned", space: rec });
    }
    if (p === "/api/spaces" && method === "GET") {
      const sp = await kv.list({ prefix: "space:" });
      const out = [];
      for (const k of sp.keys) { const x = await kv.get(k.name); if (x) out.push(typeof x === "string" ? JSON.parse(x) : x); }
      return J({ count: out.length, spaces: out });
    }

    // ============ MANY-WORLDS COMPUTING — sovereign Multiverse GPU Matrix (/api/learn/*) ==========
    // CONTEXT (golden-rule adapted): split sovereign memory into parallel universe shards,
    // spawn a matrix of ephemeral compute nodes (GPU-aware) to train each shard simultaneously,
    // then collapse the wavefunction by merging the adapter weights into collapsed_reality.bin.
    // No earthly GitHub Actions / MEGA / Cloudflare: splitter→own mirror, dispatch→own /api/compute,
    // merger→own KV + mirror, cron→our own learn_daemon (service #12).
    const W_PATH = "/root/eon-cloud-agent/workers";

    if (p === "/api/learn/spawn" && method === "POST") {
      // The Cosmic Coordinator: split memory into N universes & dispatch N parallel train tasks.
      const body = await request.json();
      const N = Math.max(1, Math.min(parseInt(body.universes || "3", 10), 8));
      const dim = parseInt(body.dim || "256", 10);
      const runId = `run-${Date.now()}`;
      const { execFileSync } = await import("node:child_process");
      let split;
      try {
        const out = execFileSync("python3", [W_PATH + "/universe_splitter.py", "--n", String(N), "--dim", String(dim)], { encoding: "utf8", timeout: 30000 });
        split = JSON.parse(out.slice(out.indexOf("{")));
      } catch (e) {
        return J({ error: "splitter failed", detail: String(e.message || e) }, 502);
      }
      const run = {
        id: runId, universes: N, dim, split_ts: split.ts, seed: split.seed_collapsed,
        created: Date.now(), status: "spawning", window_ms: 120000,
        universes_out: split.universes.map(u => ({ universe: u.universe, records: u.records, file: u.file })),
        tasks: [], adapters: {}, status: "spawning",
      };
      // Dispatch one parallel train task per universe (GPU-aware: falls to a GPU node if present).
      const ids = [];
      const base = new URL(request.url); const baseHost = `http://127.0.0.1:${process.env.EON_MESH_PORT || 8787}`;
      for (const u of split.universes) {
        const tid = `${runId}-u${u.universe}`;
        const task = { id: tid, type: "train", payload: { kind: "universe", run_id: runId, universe: u.universe, shard: u.file, dim, seed: split.seed_collapsed, records: u.records }, created: Date.now() };
        await kv.put(`task:${tid}`, JSON.stringify({ ...task, node_id: null, status: "queued" }));
        ids.push({ tid, universe: u.universe });
        // Route through the same GPU-aware coordinator so agents claim it & train their shard.
        try {
          await fetch(`${baseHost}/api/compute/dispatch`, { method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: tid, type: "train", payload: task.payload }), signal: AbortSignal.timeout(10000) });
        } catch (e) { console.error("[learn] dispatch fail", e.message); }
      }
      run.tasks = ids;
      await kv.put(`learn:${runId}`, JSON.stringify(run));
      // Signal agents: they are already claimed by /api/compute/claim (task queue). Mark state.
      return J({ status: "spawned", run_id: runId, universes: N, dim, tasks: ids.map(i => i.tid), split: split.universes, seed: { len: split.seed_collapsed.length } });
    }

    if (p === "/api/learn/status" && (method === "GET")) {
      const runId = url.searchParams.get("run_id") || "";
      if (runId) { const v = await kv.get(`learn:${runId}`); return v ? J(typeof v === "string" ? JSON.parse(v) : v) : J({ error: "run not found" }, 404); }
      const kl = await kv.list({ prefix: "learn:" });
      const runs = []; for (const k of kl.keys) { const v = await kv.get(k.name); if (v) runs.push(typeof v === "string" ? JSON.parse(v) : v); }
      return J(runs.sort((a, b) => b.created - a.created));
    }

    if (p === "/api/learn/complete" && method === "POST") {
      // A universe finished training this shard: record its adapter weights.
      const body = await request.json();
      const runId = body.run_id, uni = body.universe;
      if (!runId || uni === undefined) return J({ error: "run_id + universe required" }, 400);
      const raw = await kv.get(`learn:${runId}`);
      if (!raw) return J({ error: "run not found" }, 404);
      const run = typeof raw === "string" ? JSON.parse(raw) : raw;
      const weights = body.weights || body.adapter || [];
      const node = body.node || "unknown";
      run.adapters[String(uni)] = { weights, node, ts: Date.now() };
      const done = Object.keys(run.adapters).length;
      run.status = "collecting";
      await kv.put(`learn:${runId}`, JSON.stringify(run));
      return J({ status: "universe:complete", run_id: runId, universe: uni, node, collected: done, of: run.universes });
    }

    if (p === "/api/learn/collapse" && method === "POST") {
      // Wavefunction Collapse Merger: average all surviving universes (tolerates failure:
      // proceeds with whatever came back) -> collapsed_reality -> bump active_model_version.
      const body = await request.json();
      const runId = body.run_id;
      if (!runId) return J({ error: "run_id required" }, 400);
      const raw = await kv.get(`learn:${runId}`);
      if (!raw) return J({ error: "run not found" }, 404);
      const run = typeof raw === "string" ? JSON.parse(raw) : raw;
      const dim = run.dim || 256;
      const adapters = Object.values(run.adapters);
      const survivors = adapters.filter(a => Array.isArray(a.weights) && a.weights.length === dim);
      // Any universe that crashed is simply omitted — merger still proceeds (Robustness constraint).
      const merged = [];
      for (let j = 0; j < dim; j++) {
        let s = 0, c = 0;
        for (const a of survivors) { const w = Number(a.weights[j]); if (Number.isFinite(w)) { s += w; c++; } }
        merged.push(round3(s / Math.max(c, 1)));
      }
      // Blend with the many-worlds seed prior (from splitter) for stability.
      if (Array.isArray(run.seed)) { for (let j = 0; j < dim; j++) merged[j] = round3(0.7 * merged[j] + 0.3 * (run.seed[j] || 0)); }
      const version = Number(await kv.get("active_model_version") || "0") + 1;
      const brain = {
        version, run_id: runId, ts: Date.now(), dim,
        universes_total: run.universes, universes_survived: survivors.length,
        failed: run.universes - survivors.length,
        method: "parameter-average + seed-prior blend",
        collapsed: merged,
      };
      await kv.put("active_model_version", String(version));
      await kv.put(`learn:brain:v${version}`, JSON.stringify({ ...brain, collapsed: merged }));
      run.status = "collapsed"; run.version = version; run.collapsed_ts = Date.now();
      await kv.put(`learn:${runId}`, JSON.stringify(run));
      // Mirror collapsed brain to own fluid-cloud (all-in-cloud, no earthly).
      try {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const dir = "/mnt/fluid-cloud/brain"; mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/collapsed_reality_v${version}.json`, JSON.stringify(brain));
      } catch (e) { console.error("[learn] mirror write failed", e.message); }
      return J({ status: "collapsed", version, brain: { ...brain, collapsed: merged } });
    }

    if (p === "/api/learn/hotswap" && (method === "GET" || method === "POST")) {
      // Organic Hot-Swap: active_model_version is the single source of truth for which
      // collapsed_reality.bin the inference engines pull. GET returns it; POST(None) no-ops.
      const version = await kv.get("active_model_version") || "0";
      const brainRaw = await kv.get(`learn:brain:v${version}`);
      return J({ active_model_version: version, brain: brainRaw ? (typeof brainRaw === "string" ? JSON.parse(brainRaw) : brainRaw) : null });
    }

    if (p === "/api/benchmark/results" && method === "GET") {
      const kl = await kv.list({ prefix: "bench:" });
      const out = [];
      for (const k of kl.keys) { const v = await kv.get(k.name); if (v) out.push({ ...v }); }
      return J(out);
    }
    if (p === "/api/benchmark/results" && method === "POST") {
      const body = await request.json();
      const id = `bench:${body.ts || Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
      await kv.put(id, { ...body, ts: body.ts || Date.now(), stored: Date.now() });
      return J({ status: "stored", id });
    }

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

function benchmarkPage(env, kv) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EON Bio-AI Benchmark</title>
<style>
:root{--bg:#0b0f1a;--card:#141a2e;--line:#232c46;--tx:#d7e0ff;--dim:#7c89b8;--ac:#4d7cfe;--ok:#2ecc71;--war:#f39c12;--bad:#e74c3c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:24px}
h1{font-size:22px;margin:0 0 4px}h1 .dot{color:var(--ok)}h2{font-size:14px;color:var(--ac);text-transform:uppercase;letter-spacing:1px;margin:0 0 12px}
.sub{color:var(--dim);margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}.card h3{margin:0 0 10px;font-size:13px;color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px dashed #1c2340}th{color:var(--dim)}
.badge{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11px;font-weight:700}.b-ok{background:#0f2a1a;color:var(--ok)}.b-war{background:#2a220f;color:var(--war)}.b-dim{background:#1c2340;color:var(--dim)}
a{color:var(--ac);text-decoration:none}footer{margin-top:24px;color:var(--dim);font-size:11px}
</style></head><body>
<h1><span class="dot">●</span> BIO-AI BENCHMARK</h1>
<p class="sub">Sovereign comparison · Human Brain (20W) vs SNN (spike energy) vs LLM (tokens) · <a href="/">← Neural Web</a></p>
<div class="grid">
<div class="card"><h3>BENCHMARK TABLE</h3><div id="bm"><div class="row">loading…</div></div></div>
<div class="card"><h3>LATEST RUN</h3><div id="last"><div class="row">loading…</div></div></div>
</div>
<div style="margin-top:16px"><div class="card"><h3>12-DOMAIN MRI MATRIX (Human vs AI)</h3><div id="d12"><div class="row">no 12-domain run yet — run benchmark_runner.py</div></div></div></div>
<footer>All-in-cloud · results stored in sovereign KV · AI track via Ghost Round Matrix · SNN track via cloud GH-Actions trainer</footer>
<script>
const q=(s)=>fetch(s).then(r=>r.json()).catch(e=>({error:String(e)}));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){
const d=await q('/api/benchmark/results');
const items=(d.error?[]:d);
const table=items.length?items.map(r=>{
  const snn=r.track&&r.track.snn||{};const ai=r.track&&r.track.ai||[];const hum=r.track&&r.track.human||[];
  return '<tr><td>'+esc(r.ts)+'</td><td>'+esc(snn.train_acc||'—')+'</td><td>'+esc(snn.spike_sparsity||'—')+'</td><td>'+esc((ai[0]&&ai[0].endpoint)||'—')+'</td><td>'+hum.length+'</td></tr>';
}).join('')
:'<tr><td colspan="5" style="color:var(--dim)">no benchmark runs yet — POST /api/benchmark/results</td></tr>';
document.getElementById('bm').innerHTML='<table><tr><th>ts</th><th>SNN acc</th><th>sparsity</th><th>LLM endpoint</th><th>human</th></tr>'+table+'</table>';
const last=items[items.length-1];
if(last){const snn=last.track&&last.track.snn||{};
document.getElementById('last').innerHTML='<table><tr><th>metric</th><th>value</th></tr>'
+'<tr><td>SNN acc</td><td>'+esc(snn.train_acc||'—')+'</td></tr>'
+'<tr><td>spike sparsity</td><td>'+esc(snn.spike_sparsity||'—')+'</td></tr>'
+'<tr><td>elapsed s</td><td>'+esc(snn.elapsed_s||'—')+'</td></tr>'
+'<tr><td>human brain (W)</td><td>20</td></tr></table>';}
const dm=last&&last.track&&last.track.domains||[];
if(dm.length){const rows=dm.map(x=>'<tr><td>'+esc(x.id)+'</td><td>'+esc(x.name)+'</td><td>'
+esc(x.ai_value==null||x.ai_value===''?'—':x.ai_value)+(x.units||'')+'</td><td>'
+esc(x.human_value==null||x.human_value===''?'—':x.human_value)+(x.units||'')+'</td></tr>').join('');
document.getElementById('d12').innerHTML='<table><tr><th>domain</th><th>name</th><th>AI</th><th>human</th></tr>'+rows+'</table>';}
}
load();
</script></body></html>`;
}
