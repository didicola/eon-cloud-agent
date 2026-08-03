import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

// ── disk-backed KV: sovereign persistent store (mem-map for reads, write-through journal) ──
const STATE = '/root/eon-cloud-agent/state/kv.json';
mkdirSync('/root/eon-cloud-agent/state', { recursive: true });
const DISK = (() => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } })();
const persist = () => { const tmp = STATE + '.tmp'; writeFileSync(tmp, JSON.stringify(DISK)); renameSync(tmp, STATE); };
let writeQueue = Promise.resolve();
const enqueuePersist = () => { writeQueue = writeQueue.then(() => new Promise(res => setTimeout(res, 5))).then(persist).catch(() => {}); };

const KV = class {
  constructor(prefix) { this.m = DISK; this.prefix = prefix; }
  async put(k, value, opts) {
    const kv = JSON.stringify({ v: value, meta: opts?.metadata || null, exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null, ts: Date.now() });
    this.m[`${this.prefix}${k}`] = kv;
    enqueuePersist();
  }
  async get(k) { const r = this.m[`${this.prefix}${k}`]; if (!r) return null; const { v, exp } = JSON.parse(r); if (exp && exp < Date.now()) { delete this.m[`${this.prefix}${k}`]; enqueuePersist(); return null; } return v; }
  async getWithMetadata(k) { const r = this.m[`${this.prefix}${k}`]; if (!r) return { value: null, metadata: null }; const { v, meta, exp } = JSON.parse(r); if (exp && exp < Date.now()) { delete this.m[`${this.prefix}${k}`]; enqueuePersist(); return { value: null, metadata: null }; } return { value: v, metadata: meta }; }
  async delete(k) { delete this.m[`${this.prefix}${k}`]; enqueuePersist(); }
  async list({ prefix = '' } = {}) { const keys = []; for (const k of Object.keys(this.m)) { if (k.startsWith(`${this.prefix}${prefix}`)) keys.push({ name: k.slice(this.prefix.length) }); } return { keys }; }
};

const memKV = (p) => new KV(p);
const MESH_STATE = memKV('ms:');
const DNS_ZONE = memKV('dz:');
const SWARM_KV = memKV('sk:');

const nodes = new Map();
class MeshNodeShim {
  constructor(name) { this.name = name; this.nodes = new Map(); this.messages = []; }
  async fetch(request) {
    const url = new URL(request.url); const method = request.method;
    if (method === "POST" && url.pathname === "/register") {
      const body = await request.json();
      this.nodes.set(body.node_id, { ...body, last_seen: Date.now(), online: true });
      nodes.set(body.node_id, this.name);
      await MESH_STATE.put(`node:${body.node_id}`, JSON.stringify(body), { expirationTtl: 86400 });
      return this.json({ status: "registered", node_id: body.node_id, peers: this.nodes.size, host: this.name });
    }
    if (method === "GET" && url.pathname === "/peers") {
      return this.json({ peers: Array.from(this.nodes.values()), count: this.nodes.size });
    }
    if (method === "POST" && url.pathname === "/relay") {
      const b = await request.json();
      this.messages.push({ from: b.sender, to: b.target, payload: b.payload, ts: Date.now() });
      if (this.nodes.has(b.target)) return this.json({ status: "relayed", target: b.target });
      await MESH_STATE.put(`msg:${b.target}:${Date.now()}`, JSON.stringify(b), { expirationTtl: 3600 });
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
  json(d, c = 200) { return new Response(JSON.stringify(d), { status: c, headers: { "Content-Type": "application/json" } }); }
}

const DO_BINDING = {
  idFromName(name) { return { name }; },
  get(id) { return new MeshNodeShim(id.name); }
};

const env = {
  MESH_STATE, DNS_ZONE, SWARM_KV,
  MESH_NODES: DO_BINDING
};

const worker = await import('./shadow-mesh.js').catch(async () => {
  return import('/root/eon-cloud-agent/workers/shadow-mesh.js');
});

const handler = worker.default.fetch;

const server = createServer(async (req, res) => {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((ok) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => ok(d)); });
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, v);
  const request = new Request(url, { method: req.method, headers, body: body || undefined });

  try {
    const resp = await handler(request, env);
    res.writeHead(resp.status, Object.fromEntries(resp.headers.entries()));
    res.end(await resp.text());
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(8787, '127.0.0.1', () => console.log('EON mesh host on :8787'));

process.on('uncaughtException', (e) => console.error('mesh-host uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('mesh-host rejection:', e.message));
