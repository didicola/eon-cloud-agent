import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync, existsSync } from 'node:fs';

// ── sovereign access token: env EON_ACCESS_TOKEN, else load from state/.mesh-token.env
//    (single source for both boot_stack and mesh-supervisor launches) ──
if (!process.env.EON_ACCESS_TOKEN) {
  try {
    const t = readFileSync('/root/eon-cloud-agent/state/.mesh-token.env', 'utf8');
    const m = t.match(/EON_ACCESS_TOKEN=(\S+)/);
    if (m) process.env.EON_ACCESS_TOKEN = m[1];
  } catch {}
}

// ── disk-backed KV: sovereign persistent store (mem-map for reads, write-through journal) ──
const STATE = '/root/eon-cloud-agent/state/kv.json';
const WAL_FILE = '/root/eon-cloud-agent/state/kv.wal';
const WAL_CHECKPOINT = Number(process.env.EON_WAL_CHECKPOINT || 50);
mkdirSync('/root/eon-cloud-agent/state', { recursive: true });
const DISK = (() => {
  let d = {};
  try { d = JSON.parse(readFileSync(STATE, 'utf8')); } catch {}
  // ── WAL recovery: replay any acknowledged-but-not-yet-checkpointed writes in order ──
  try {
    if (existsSync(WAL_FILE)) {
      const w = readFileSync(WAL_FILE, 'utf8');
      let n = 0;
      for (const line of w.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (r.op === 'put') d[r.k] = r.v;
          else if (r.op === 'del') delete d[r.k];
          n++;
        } catch {}
      }
      if (n > 0) {
        console.log(`[wal] recovered ${n} ops`);
        // snapshot immediately so recovered entries survive even if the next
        // write never happens before a subsequent crash (WAL was truncated).
        try { const tmp = STATE + '.tmp'; writeFileSync(tmp, JSON.stringify(d)); renameSync(tmp, STATE); } catch {}
        try { writeFileSync(WAL_FILE, ''); } catch {}
      }
    }
  } catch {}
  return d;
})();
const walAppend = (op, k, v) => {
  // write-through: sync append BEFORE persist enters the queue keeps WAL order == final state order
  try { appendFileSync(WAL_FILE, JSON.stringify({ op, k, v, t: Date.now() }) + '\n'); } catch {}
};
let walOps = 0;
const persist = () => {
  const tmp = STATE + '.tmp';
  writeFileSync(tmp, JSON.stringify(DISK));
  renameSync(tmp, STATE);
  // WAL checkpoint: the snapshot just captured everything acknowledged so far → truncate WAL
  walOps++;
  if (walOps >= WAL_CHECKPOINT) {
    try { writeFileSync(WAL_FILE, ''); } catch {}
    walOps = 0;
  }
};
let writeQueue = Promise.resolve();
const enqueuePersist = () => { writeQueue = writeQueue.then(() => new Promise(res => setTimeout(res, 5))).then(persist).catch(() => {}); };
console.log(`[wal] journaling to ${WAL_FILE}`);

const KV = class {
  constructor(prefix) { this.m = DISK; this.prefix = prefix; }
  async put(k, value, opts) {
    // SOVEREIGN KV BLOAT GUARD: refuse to store a single value larger than MAX_VAL
    // (the envelope-nesting bug drove task/train blobs to 407KB, killing replica sync).
    const MAX_VAL = Number(process.env.EON_KV_MAX_VALUE || 65536);
    let size;
    try { size = Buffer.byteLength(JSON.stringify(value)); } catch { size = 0; }
    if (size > MAX_VAL) {
      const kind = String(k).split(':')[0];
      console.error(`[kv] REFUSED oversized value ${kind}:${k.slice(0,40)} size=${size} > ${MAX_VAL}`);
      return { oversized: true, key: k, size };
    }
    const kv = JSON.stringify({ v: value, meta: opts?.metadata || null, exp: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null, ts: Date.now() });
    this.m[`${this.prefix}${k}`] = kv;
    walAppend('put', `${this.prefix}${k}`, kv);
    enqueuePersist();
    return { ok: true };
  }
  async get(k) { const r = this.m[`${this.prefix}${k}`]; if (!r) return null; const { v, exp } = JSON.parse(r); if (exp && exp < Date.now()) { delete this.m[`${this.prefix}${k}`]; enqueuePersist(); return null; } return v; }
  async getWithMetadata(k) { const r = this.m[`${this.prefix}${k}`]; if (!r) return { value: null, metadata: null }; const { v, meta, exp, ts } = JSON.parse(r); if (exp && exp < Date.now()) { delete this.m[`${this.prefix}${k}`]; enqueuePersist(); return { value: null, metadata: null }; } return { value: v, metadata: meta, ts: ts || 0 }; }
  async delete(k) { delete this.m[`${this.prefix}${k}`]; walAppend('del', `${this.prefix}${k}`, null); enqueuePersist(); }
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

server.listen(8787, '127.0.0.1', () => console.log(`EON mesh host on :8787, wal:${WAL_FILE}`));

process.on('uncaughtException', (e) => console.error('mesh-host uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('mesh-host rejection:', e.message));
