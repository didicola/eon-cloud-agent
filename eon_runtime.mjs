#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// EON Worker Runtime v4.2.0 — local alternative to Cloudflare Workers
// Serves Workers on *.eon-mesh.internal (127.0.0.1:8787 + HTTPS :443)
// Features: KV(TTL/meta/pagination), Secrets, cron/scheduled handlers,
//   ctx.waitUntil, request timeouts, service bindings, auth'd mgmt plane,
//   health/metrics, atomic versioned deploys, streaming responses,
//   Durable Objects (single-flight, KV-persisted), Queues, R2 storage,
//   env.AI binding, crash containment fence, request IDs
// ═══════════════════════════════════════════════════════════════
import {
  readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync,
  rmSync, renameSync, readlinkSync, symlinkSync, statSync, appendFileSync, chmodSync
} from 'fs';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';

const PORT = +process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 8787;
const WORKERS_DIR = '/mnt/fluid-cloud/cloud-opencode/workers';
const KV_DIR = '/mnt/fluid-cloud/cloud-opencode/kv';
const SECRETS_DIR = '/mnt/fluid-cloud/cloud-opencode/secrets';
const LOGS_DIR = '/mnt/fluid-cloud/cloud-opencode/logs';
const CERTS_DIR = '/mnt/fluid-cloud/cloud-opencode/certs';
const TOKEN_FILE = '/tmp/eon_runtime.token';
const ENABLE_HTTPS = process.argv.includes('--https');
const NO_AUTH = process.argv.includes('--no-auth');
const REQUEST_TIMEOUT = +process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] || 30000;
const VERSION = '4.2.0';
const STARTED = Date.now();

for (const d of [WORKERS_DIR, KV_DIR, SECRETS_DIR, LOGS_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ─── Crash containment fence ─────────────────────────────────
// One bad worker must never kill the cloud: log the crash to
// runtime-crash.log, drop the module cache so the next request
// reloads clean modules, then keep serving (do NOT re-throw).
function logCrash(type, e) {
  try {
    appendFileSync(`${LOGS_DIR}/runtime-crash.log`, JSON.stringify({
      ts: new Date().toISOString(), type,
      message: e?.message || String(e),
      stack: e?.stack || ''
    }) + '\n');
  } catch {}
}
process.on('uncaughtException', (e) => {
  logCrash('uncaughtException', e);
  console.error('[runtime] uncaughtException contained:', e?.message || e);
  try { workers.clear(); doInstances.clear(); } catch {}
});
process.on('unhandledRejection', (e) => {
  logCrash('unhandledRejection', e);
  console.error('[runtime] unhandledRejection contained:', e?.message || e);
  try { workers.clear(); doInstances.clear(); } catch {}
});

// ─── Auth ────────────────────────────────────────────────────
function readToken() {
  try { return existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf-8').trim() : ''; }
  catch { return ''; }
}
const AUTH_TOKEN = process.argv.find(a => a.startsWith('--token='))?.split('=')[1] || readToken();
function authorized(req) {
  if (NO_AUTH || !AUTH_TOKEN) return true;
  const h = req.headers['x-eon-token']
    || (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : '');
  return h === AUTH_TOKEN;
}

// ─── KV Emulation (TTL + metadata + pagination) ──────────────
const safe = (k) => k.replace(/[^a-zA-Z0-9:_-]/g, '_');
class LocalKV {
  constructor(namespace) {
    this.ns = namespace;
    this.dir = `${KV_DIR}/${namespace}`;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }
  _path(key) { return `${this.dir}/${safe(key)}`; }
  _expired(path) {
    const ttl = `${path}.ttl`;
    if (!existsSync(ttl)) return false;
    return Date.now() >= +readFileSync(ttl, 'utf-8');
  }
  get(key) {
    const path = this._path(key);
    if (!existsSync(path) || this._expired(path)) return null;
    return readFileSync(path, 'utf-8');
  }
  put(key, value, opts = {}) {
    const path = this._path(key);
    // write-temp-then-rename: a crash never leaves a partial canonical file
    writeFileSync(`${path}.tmp`, value);
    renameSync(`${path}.tmp`, path);
    if (opts.metadata) { writeFileSync(`${path}.meta.tmp`, JSON.stringify(opts.metadata)); renameSync(`${path}.meta.tmp`, `${path}.meta`); }
    else if (existsSync(`${path}.meta`)) rmSync(`${path}.meta`);
    if (opts.expirationTtl) { writeFileSync(`${path}.ttl.tmp`, String(Date.now() + opts.expirationTtl * 1000)); renameSync(`${path}.ttl.tmp`, `${path}.ttl`); }
    else if (opts.expiration) { writeFileSync(`${path}.ttl.tmp`, String(opts.expiration)); renameSync(`${path}.ttl.tmp`, `${path}.ttl`); }
    else if (existsSync(`${path}.ttl`)) rmSync(`${path}.ttl`);
    return true;
  }
  delete(key) {
    const path = this._path(key);
    for (const ext of ['', '.meta', '.ttl']) { try { rmSync(path + ext); } catch {} }
    return true;
  }
  getWithMetadata(key) {
    const path = this._path(key);
    if (!existsSync(path) || this._expired(path)) return { value: null, metadata: null };
    const meta = existsSync(`${path}.meta`) ? JSON.parse(readFileSync(`${path}.meta`, 'utf-8')) : null;
    const exp = existsSync(`${path}.ttl`) ? +readFileSync(`${path}.ttl`, 'utf-8') : null;
    return { value: readFileSync(path, 'utf-8'), metadata: meta, expiration: exp };
  }
  list(opts = {}) {
    const prefix = safe(opts.prefix || '');
    const limit = Math.min(opts.limit || 1000, 1000);
    const cursor = +(opts.cursor || 0);
    let files = readdirSync(this.dir).filter(f => !f.endsWith('.meta') && !f.endsWith('.ttl') && !f.endsWith('.tmp'));
    // drop expired: move canonical files aside via .tmp first, then sweep
    // leftovers, so a crash never leaves a partial canonical file behind
    for (const f of files) {
      if (this._expired(`${this.dir}/${f}`)) {
        for (const ext of ['', '.meta', '.ttl']) { try { renameSync(`${this.dir}/${f}${ext}`, `${this.dir}/${f}${ext}.tmp`); } catch {} }
      }
    }
    for (const f of readdirSync(this.dir)) { if (f.endsWith('.tmp')) { try { rmSync(`${this.dir}/${f}`); } catch {} } }
    files = readdirSync(this.dir).filter(f => !f.endsWith('.meta') && !f.endsWith('.ttl') && !f.endsWith('.tmp') && f.startsWith(prefix));
    const page = files.slice(cursor, cursor + limit).map(name => ({ name }));
    const nextCursor = cursor + limit < files.length ? String(cursor + limit) : undefined;
    return { keys: page, cursor: nextCursor, list_complete: !nextCursor };
  }
}

// ─── Secrets (per-worker, mode 0600) ─────────────────────────
function loadSecrets(worker) {
  const dir = `${SECRETS_DIR}/${worker}`;
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    try { out[f] = readFileSync(`${dir}/${f}`, 'utf-8'); } catch {}
  }
  return out;
}

// ─── Logging (JSON-lines, per-worker for `eon tail`) ─────────
function logLine(worker, level, msg, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  try { appendFileSync(`${LOGS_DIR}/${worker}.log`, line + '\n'); } catch {}
}

// ─── AI binding (blind-proxy gateway, OpenAI-compatible) ─────
const AI_GATEWAY = 'http://127.0.0.1:8090/v1';
const AI_TIMEOUT_MS = 60000;
async function aiFetch(path, options = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), options.timeoutMs || AI_TIMEOUT_MS);
    try {
      const res = await fetch(`${AI_GATEWAY}${path}`, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`AI gateway ${path}: HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise(r => setTimeout(r, 500));
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`AI request failed: ${lastErr?.message || 'unknown error'}`);
}
function makeAiBinding(workerName) {
  const rec = (ms) => {
    const s = bump(workerName, 'ai');
    s.aiCalls++;
    s.aiLatencyMs += ms;
  };
  return {
    gateway: AI_GATEWAY,
    async chat(opts = {}) {
      const t0 = Date.now();
      try {
        const { model, messages, tools, stream } = opts;
        const body = { model, messages, tools };
        if (stream) body.stream = true;
        const res = await aiFetch('/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer sk-dummy' },
          body: JSON.stringify(body)
        });
        const text = await res.text();
        if (stream) {
          const chunks = [];
          for (const line of text.split('\n')) {
            const l = line.trim();
            if (!l.startsWith('data:')) continue;
            const payload = l.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              for (const ch of (parsed.choices || [])) {
                if (ch.delta && ch.delta.content != null) chunks.push(ch.delta.content);
              }
            } catch {}
          }
          return { streamed: chunks, model };
        }
        const parsed = JSON.parse(text);
        // blind-proxy wraps upstream provider errors as { status: "4xx", msg } in HTTP 200 — surface them
        if (parsed && parsed.status && String(parsed.status) !== '200' && !parsed.choices) {
          throw new Error(`AI chat: upstream ${parsed.status} ${parsed.msg || parsed.error || ''}`.trim());
        }
        return { choices: parsed.choices, usage: parsed.usage, model: parsed.model, raw: parsed };
      } finally {
        rec(Date.now() - t0);
      }
    },
    async models() {
      const t0 = Date.now();
      try {
        const res = await aiFetch('/models');
        const parsed = await res.json();
        return { models: parsed.data || parsed.models || [] };
      } finally {
        rec(Date.now() - t0);
      }
    }
  };
}

// ─── Durable Objects (single-flight, KV-persisted) ───────────
// Workers write: `class MyDO extends DurableObject { constructor(state, env) {...} async fetch(request) {...} }`
//   and export the class. `DurableObject` is available as a global (bare identifier),
//   mirroring `cloudflare:workers`. Namespaces come from meta.do_bindings ("NAME=ClassName").
class DurableObjectBase {
  constructor(state, env) { this.state = state; this.env = env; }
}
globalThis.DurableObject = DurableObjectBase;

const doInstances = new Map(); // "bindName:id" -> DoInstance

function makeDoStorage(kv) {
  return {
    async get(key) {
      if (key == null) {
        const out = {};
        const r = kv.list({ limit: 1000 });
        for (const k of (r.keys || [])) { const v = kv.get(k.name); if (v != null) { try { out[k.name] = JSON.parse(v); } catch { out[k.name] = v; } } }
        return out;
      }
      const v = kv.get(key);
      if (v == null) return undefined;
      try { return JSON.parse(v); } catch { return v; }
    },
    async put(key, value, opts = {}) { kv.put(key, JSON.stringify(value), opts); },
    async delete(key) { kv.delete(key); },
    async list(opts = {}) { const r = kv.list(opts); return { keys: (r.keys || []).map(k => ({ name: k.name })), cursor: r.cursor }; }
  };
}

class DoInstance {
  constructor(workerName, bindName, id, Class, env) {
    this.key = `${bindName}:${id}`;
    this.workerName = workerName;
    this.bindName = bindName;
    this.id = id;
    this._chain = Promise.resolve();
    this._waitUntil = [];
    this.storage = new LocalKV(`__do/${bindName}/${id}`);
    const self = this;
    const state = {
      storage: makeDoStorage(this.storage),
      id,
      waitUntil: (p) => { self._waitUntil.push(Promise.resolve(p).catch(() => {})); },
      blockConcurrencyWhile: (p) => { self._chain = self._chain.then(() => Promise.resolve(p).catch(() => {})); }
    };
    this.obj = new Class(state, env);
  }
  run(thunk) {
    const run = this._chain.then(thunk);
    this._chain = run.then(() => {}, () => {});
    return run;
  }
}

function findDoClass(worker, className) {
  if (!worker.mod) return null;
  for (const v of Object.values(worker.mod)) {
    if (typeof v === 'function' && v.prototype && v.prototype instanceof DurableObjectBase) {
      if (!className || v.name === className) return v;
    }
  }
  return null;
}

async function dispatchDo(worker, bindName, className, id, input, init) {
  const mod = await worker.loadModule();
  const Class = findDoClass(worker, className);
  if (!Class) throw new Error(`DO class '${className || '?'}' not exported by worker ${worker.name}`);
  const key = `${bindName}:${id}`;
  let inst = doInstances.get(key);
  if (!inst) { inst = new DoInstance(worker.name, bindName, id, Class, worker.env); doInstances.set(key, inst); }
  let urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.url);
  const method = (init?.method || (input instanceof Request ? input.method : 'GET'));
  const headers = Object.fromEntries(
    init?.headers ? new Headers(init.headers).entries() : (input instanceof Request ? input.headers.entries() : [])
  );
  const body = init?.body ?? (input instanceof Request ? await input.text() : undefined);
  const request = new Request(urlStr, { method, headers, body });
  const ms = worker.meta.timeout_ms || REQUEST_TIMEOUT;
  try {
    const res = await inst.run(() => withTimeout(inst.obj.fetch(request), ms, 'do.fetch'));
    for (const p of inst._waitUntil) p.catch(() => {});
    inst._waitUntil = [];
    bumpDo(worker.name, true);
    return res;
  } catch (e) {
    bumpDo(worker.name, false);
    logLine(worker.name, 'error', `DO ${bindName}:${id}`, { error: e.message });
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

function makeDoNamespace(getWorker, bindName, className) {
  const nsKey = `${bindName}:${className || ''}`;
  return {
    idFromName(name) { return createHash('sha256').update(`${nsKey}:${name}`).digest('hex').slice(0, 32); },
    newUniqueId() { return randomBytes(16).toString('hex'); },
    idFromString(s) { return String(s); },
    get(id) {
      if (!/^[0-9a-f]{32}$/.test(String(id))) throw new Error(`invalid Durable Object id: ${id}`);
      return { fetch: (input, init) => dispatchDo(getWorker(), bindName, className, String(id), input, init) };
    }
  };
}

// ─── Queues (persistent producer→consumer, batch delivery) ───
// Producer: meta.queues.producers { NAME: queueName } → env.NAME.send(msg)
// Consumer: meta.queues.consumers [queueName] + worker exports `async queue(batch, ctx)`.
// Extension over CF: multiple consumers of one queue fan out (each gets a copy).
function makeQueueProducer(queueName) {
  return {
    async send(message, opts = {}) {
      const dir = `${KV_DIR}/__queues/${queueName}`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
      writeFileSync(`${dir}/${id}.json`, JSON.stringify({ id, ts: Date.now(), body: message, delay: opts.delaySeconds || 0, retries: 0 }));
      return id;
    },
    async sendBatch(messages = []) { const ids = []; for (const m of messages) ids.push(await this.send(m)); return ids; }
  };
}

function buildConsumerMap() {
  const map = new Map(); // queueName -> Set(worker names)
  for (const name of readdirSync(WORKERS_DIR)) {
    const w = loadWorker(name);
    if (!w || !Array.isArray(w.meta.queues?.consumers)) continue;
    for (const q of w.meta.queues.consumers) {
      if (!map.has(q)) map.set(q, new Set());
      map.get(q).add(name);
    }
  }
  return map;
}

async function deliverQueues() {
  for (const [queueName, workerNames] of buildConsumerMap()) {
    const dir = `${KV_DIR}/__queues/${queueName}`;
    if (!existsSync(dir)) continue;
    let files;
    try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
    if (!files.length) continue;
    for (const workerName of workerNames) {
      const worker = getOrCreateWorkerModule(workerName);
      if (!worker) continue;
      const mod = await worker.loadModule();
      const ex = mod.default || mod;
      if (typeof ex.queue !== 'function') continue;
      const maxBatch = worker.meta.queues?.max_batch_size || 10;
      const batchMsgs = []; const ids = [];
      const now = Date.now();
      for (const f of files) {
        let m;
        try { m = JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8')); } catch { try { rmSync(`${dir}/${f}`); } catch {} continue; }
        if (m.delay && now < (m.ts || now) + m.delay * 1000) continue; // delayed, not due yet
        batchMsgs.push({ id: m.id, timestamp: m.ts, body: m.body, attempts: m.retries || 0 });
        ids.push(f);
        if (batchMsgs.length >= maxBatch) break;
      }
      if (!batchMsgs.length) continue;
      const ctx = makeContext(worker);
      try {
        await withTimeout(ex.queue({ messages: batchMsgs, queue: queueName, batchSize: batchMsgs.length }, ctx),
          worker.meta.timeout_ms || REQUEST_TIMEOUT, 'queue');
        for (const id of ids) { try { rmSync(`${dir}/${id}`); } catch {} }
        for (const p of ctx.pending) p.catch(() => {});
        bump(workerName, 'ok');
        logLine(workerName, 'info', `queue delivered ${batchMsgs.length} msgs from ${queueName}`);
      } catch (e) {
        for (const id of ids) {
          try {
            const m = JSON.parse(readFileSync(`${dir}/${id}`, 'utf-8'));
            m.retries = (m.retries || 0) + 1;
            if (m.retries >= 3) { rmSync(`${dir}/${id}`); logLine(workerName, 'error', `queue ${queueName}: dropped msg ${m.id} after 3 attempts`); }
            else writeFileSync(`${dir}/${id}`, JSON.stringify(m));
          } catch {}
        }
        logLine(workerName, 'error', `queue ${queueName} delivery failed: ${e.message}`);
        bump(workerName, 'err');
      }
    }
  }
}
setInterval(() => { try { deliverQueues(); } catch (e) { console.error('[runtime] queue delivery:', e.message); } }, 2000);

// ─── R2-style object storage ─────────────────────────────────
// meta.r2_bindings { NAME: bucket } → env.NAME.put/get/delete/list
function makeR2Binding(bucketName) {
  const dir = `${KV_DIR}/__r2/${bucketName}`;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const pathFor = (key) => `${dir}/${safe(key)}`;
  return {
    async put(key, value, opts = {}) {
      const p = pathFor(key);
      writeFileSync(`${p}.tmp`, String(value));
      renameSync(`${p}.tmp`, p);
      const meta = { key, etag: createHash('sha1').update(String(value)).digest('hex'), size: Buffer.byteLength(String(value)), customMetadata: opts.customMetadata || {}, httpMetadata: opts.httpMetadata || {}, uploaded: Date.now() };
      writeFileSync(`${p}.meta`, JSON.stringify(meta));
      return { key, etag: meta.etag, size: meta.size };
    },
    async get(key) {
      const p = pathFor(key);
      if (!existsSync(p)) return null;
      const meta = existsSync(`${p}.meta`) ? JSON.parse(readFileSync(`${p}.meta`, 'utf-8')) : {};
      const body = new Response(String(readFileSync(p, 'utf-8')));
      return { key, body: body.body, size: meta.size, etag: meta.etag, httpMetadata: meta.httpMetadata, customMetadata: meta.customMetadata, text: () => body.text(), json: () => body.json() };
    },
    async delete(key) { for (const ext of ['', '.meta']) { try { rmSync(pathFor(key) + ext); } catch {} } },
    async list(opts = {}) {
      let files;
      try { files = readdirSync(dir).filter(f => !f.endsWith('.meta') && !f.endsWith('.tmp') && f.startsWith(safe(opts.prefix || ''))); } catch { files = []; }
      const limit = Math.min(opts.limit || 1000, 1000);
      const objects = files.slice(0, limit).map(f => ({ key: f, size: statSync(`${dir}/${f}`).size }));
      return { objects, truncated: files.length > limit };
    }
  };
}

// ─── Stats ───────────────────────────────────────────────────
const stats = new Map();
function bump(name, key) {
  if (!stats.has(name)) stats.set(name, { requests: 0, errors: 0, aiCalls: 0, aiLatencyMs: 0, doCalls: 0, doErrors: 0, lastSuccess: null, lastError: null, startedAt: STARTED });
  const s = stats.get(name);
  if (key === 'req') s.requests++;
  if (key === 'err') { s.errors++; s.lastError = Date.now(); }
  if (key === 'ok') s.lastSuccess = Date.now();
  return s;
}
function bumpDo(workerName, ok) {
  const s = bump(workerName, ok ? 'ok' : 'err');
  if (ok) s.doCalls++; else s.doErrors++;
  return s;
}

// Latency samples per worker (ring buffer, max 1000) for the histogram
const perWorkerLatency = new Map();
function trackLatency(name, ms) {
  if (!perWorkerLatency.has(name)) perWorkerLatency.set(name, []);
  const arr = perWorkerLatency.get(name);
  arr.push(ms);
  if (arr.length > 1000) arr.shift();
}

// Event-loop lag gauge: how late a 100ms tick actually fires
let eventLoopLagMs = 0;
let lastLagTick = Date.now();
setInterval(() => {
  const now = Date.now();
  eventLoopLagMs = Math.max(0, now - lastLagTick - 100);
  lastLagTick = now;
}, 100);

// ─── Worker Registry (atomic versioned) ──────────────────────
const workers = new Map(); // name -> registered

function loadWorker(name) {
  const dir = `${WORKERS_DIR}/${name}`;
  if (!existsSync(dir)) return null;
  const current = `${dir}/current`;
  const vdir = existsSync(current) ? `${dir}/${readlinkSync(current)}` : dir;
  const jsPath = `${vdir}/worker.js`;
  const metaPath = `${vdir}/meta.json`;
  if (!existsSync(jsPath)) return null;
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {};
  return { name, dir, vdir, meta, jsPath, version: meta.version || 'legacy' };
}

function getOrCreateWorkerModule(name) {
  const w = loadWorker(name);
  if (!w) return null;
  if (workers.has(name) && !process.argv.includes('--no-cache')) return workers.get(name);

  const env = {};
  // KV bindings
  for (const b of (w.meta.kv_bindings || [])) {
    const [bindName, ns] = b.split('=');
    env[bindName] = new LocalKV(ns || bindName.toLowerCase());
  }
  // DO bindings (real namespaces — class resolved lazily on first stub fetch)
  for (const b of (w.meta.do_bindings || [])) {
    const [bindName, className] = b.split('=');
    env[bindName] = makeDoNamespace(() => registered, bindName, className || '');
  }
  // Queues (producer bindings)
  for (const [bindName, queueName] of Object.entries(w.meta.queues?.producers || {})) {
    env[bindName] = makeQueueProducer(queueName);
  }
  // R2-style object storage bindings
  for (const [bindName, bucket] of Object.entries(w.meta.r2_bindings || {})) {
    env[bindName] = makeR2Binding(bucket);
  }
  // Secrets
  Object.assign(env, loadSecrets(name));
  // Vars
  Object.assign(env, w.meta.vars || {});
  // AI binding (blind-proxy gateway — always available to every worker)
  env.AI = makeAiBinding(name);
  if (w.meta.ai && w.meta.ai.default_model) env.AI.defaultModel = w.meta.ai.default_model;
  // Service bindings (worker→worker)
  for (const [bindName, target] of Object.entries(w.meta.services || {})) {
    env[bindName] = {
      fetch: (input, init) => internalFetch(target, input, init)
    };
  }

  const registered = {
    name, env, version: w.version, meta: w.meta,
    loadModule: async () => {
      if (registered.mod) return registered.mod;
      const moduleUrl = new URL(`file://${w.jsPath}`).href;
      const mod = await import(`${moduleUrl}?t=${Date.now()}`);
      registered.mod = mod;
      return mod;
    }
  };
  workers.set(name, registered);
  return registered;
}

// ─── Cron scheduler (5-field, KV-persisted last-run) ─────────
const cronCache = new Map();
function parsePart(part, min, max) {
  const out = new Set();
  if (part === '*') { for (let i = min; i <= max; i++) out.add(i); return out; }
  for (const seg of part.split(',')) {
    if (seg.startsWith('*/')) { const s = +seg.slice(2) || 1; for (let i = min; i <= max; i += s) out.add(i); }
    else if (seg.includes('-')) { const [a, b] = seg.split('-').map(Number); for (let i = a; i <= b; i++) out.add(i); }
    else if (!isNaN(+seg)) out.add(+seg);
  }
  return out;
}
function cronParts(expr) {
  if (!cronCache.has(expr)) {
    const [m, h, d, mo, dow] = expr.trim().split(/\s+/);
    cronCache.set(expr, [
      parsePart(m, 0, 59), parsePart(h, 0, 23), parsePart(d, 1, 31), parsePart(mo, 1, 12), parsePart(dow, 0, 6)
    ]);
  }
  return cronCache.get(expr);
}
function cronMatches(expr, date) {
  const [MM, HH, DD, MO, DOW] = cronParts(expr);
  return MM.has(date.getMinutes()) && HH.has(date.getHours()) && DD.has(date.getDate())
    && MO.has(date.getMonth() + 1) && DOW.has(date.getDay());
}
const cronKV = new LocalKV('__cron');
function cronTick() {
  const now = new Date();
  const stamp = now.getFullYear() * 1e8 + (now.getMonth() + 1) * 1e6 + now.getDate() * 1e4 + now.getHours() * 100 + now.getMinutes();
  for (const name of readdirSync(WORKERS_DIR)) {
    const w = loadWorker(name);
    if (!w) continue;
    for (const expr of (w.meta.crons || [])) {
      const lastKey = `${name}:${expr}`;
      const last = +cronKV.get(lastKey) || 0;
      if (cronMatches(expr, now) && last !== stamp) {
        cronKV.put(lastKey, String(stamp));
        const event = { cron: expr, scheduledTime: now.toISOString() };
        fireScheduled(name, event).catch(e => logLine(name, 'error', `cron ${expr}: ${e.message}`));
      }
    }
  }
}
function scheduleNextTick() {
  const now = Date.now();
  const next = Math.ceil(now / 60000) * 60000 + 1000;
  setTimeout(() => { try { cronTick(); } catch (e) { console.error('[runtime] cron tick:', e.message); } scheduleNextTick(); }, next - now);
}
async function fireScheduled(name, event) {
  const worker = getOrCreateWorkerModule(name);
  if (!worker) return;
  const mod = await worker.loadModule();
  const ex = mod.default || mod;
  const ctx = makeContext(worker);
  if (ex && typeof ex.scheduled === 'function') {
    await withTimeout(ex.scheduled(event, worker.env, ctx), worker.meta.timeout_ms || REQUEST_TIMEOUT, 'scheduled');
  } else if (ex && typeof ex.fetch === 'function') {
    const url = `http://${name}.eon-mesh.internal/?__scheduled=1&cron=${encodeURIComponent(event.cron)}`;
    const r = new Request(url, { method: 'POST', body: JSON.stringify(event), headers: { 'content-type': 'application/json', 'x-eon-scheduled': '1' } });
    await withTimeout(ex.fetch(r, worker.env, ctx), worker.meta.timeout_ms || REQUEST_TIMEOUT, 'scheduled');
  }
  logLine(name, 'info', `cron fired ${event.cron}`);
  bump(name, 'ok');
}

// ─── ctx + timeout helpers ───────────────────────────────────
function makeContext(worker) {
  const pending = [];
  return {
    waitUntil(p) { pending.push(Promise.resolve(p).catch(e => logLine(worker?.name || 'runtime', 'error', `waitUntil: ${e.message}`))); },
    passThroughOnException() {},
    pending
  };
}
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// ─── Worker dispatch (shared by HTTP + service bindings) ─────
async function callWorker(worker, request, ctx) {
  const mod = await worker.loadModule();
  const ex = mod.default || mod;
  if (!ex || typeof ex.fetch !== 'function') throw new Error('worker has no fetch handler');
  const c = ctx || makeContext(worker);
  const ms = worker.meta.timeout_ms || REQUEST_TIMEOUT;
  let response;
  try {
    response = await withTimeout(ex.fetch(request, worker.env, c), ms, 'fetch');
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
  if (!response || typeof response.status !== 'number') throw new Error('worker returned invalid response');
  for (const p of c.pending) p.catch(() => {});
  return response;
}

async function internalFetch(target, input, init) {
  const worker = getOrCreateWorkerModule(target);
  if (!worker) return new Response(JSON.stringify({ error: `unknown service target: ${target}` }), { status: 404, headers: { 'content-type': 'application/json' } });
  let urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.url);
  const method = (init?.method || (input instanceof Request ? input.method : 'GET'));
  const headers = Object.fromEntries(
    init?.headers ? new Headers(init.headers).entries() : (input instanceof Request ? input.headers.entries() : [])
  );
  const body = init?.body ?? (input instanceof Request ? await input.text() : undefined);
  const request = new Request(urlStr, { method, headers, body });
  try { return await callWorker(worker, request); }
  catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'content-type': 'application/json' } }); }
}

// ─── Write response to Node socket (streaming) ───────────────
function writeResponse(res, response, reqId) {
  const status = response.status || 200;
  const headers = {};
  if (response.headers?.forEach) response.headers.forEach((v, k) => headers[k] = v);
  headers['access-control-allow-origin'] = headers['access-control-allow-origin'] || '*';
  if (reqId) headers['x-eon-request-id'] = reqId;
  res.writeHead(status, headers);
  if (response.body && status !== 204 && status !== 304) {
    let stream = null;
    try { stream = Readable.fromWeb(response.body); } catch { res.end(); return; }
    // never hang: teardown cleanly on socket close/error or stream error
    res.on('close', () => { try { stream.destroy(); } catch {} });
    res.on('error', () => { try { stream.destroy(); } catch {} });
    stream.on('error', () => { try { res.destroy(); } catch {} });
    stream.pipe(res);
  } else {
    res.end();
  }
}

// ─── HTTP Server ─────────────────────────────────────────────
async function serverListener(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const host = req.headers.host || 'localhost';
  const subdomain = host.split('.')[0];
  const reqId = randomBytes(4).toString('hex');
  const t0 = Date.now();

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'x-eon-request-id': reqId });
    res.end(JSON.stringify(data));
  };
  const requireAuth = () => {
    if (authorized(req)) return true;
    json({ error: 'unauthorized', hint: 'set x-eon-token header or use eondeploy' }, 401);
    return false;
  };

  // ─── Management endpoints (auth'd) ───────────────────────
  if (url.pathname.startsWith('/__')) {
    logLine('runtime', 'info', `${req.method} ${url.pathname}`, { reqId, ms: Date.now() - t0 });
    if (url.pathname === '/__health') {
      const list = [];
      for (const name of readdirSync(WORKERS_DIR)) {
        const w = loadWorker(name);
        if (!w) continue;
        const s = stats.get(name) || { requests: 0, errors: 0, lastSuccess: null, lastError: null };
        const hw = {
          name, version: w.version, requests: s.requests, errors: s.errors,
          ok: !s.lastError || (s.lastSuccess > s.lastError),
          lastSuccess: s.lastSuccess, lastError: s.lastError,
          crons: w.meta.crons || []
        };
        if (s.aiCalls > 0) { hw.aiCalls = s.aiCalls; hw.aiLatencyMs = s.aiLatencyMs; }
        if (s.doCalls > 0) { hw.doCalls = s.doCalls; hw.doErrors = s.doErrors; }
        list.push(hw);
      }
      json({ status: 'ok', runtime: { version: VERSION, pid: process.pid, uptime_s: Math.round((Date.now() - STARTED) / 1000), durable_objects: doInstances.size }, workers: list });
      return;
    }
    if (url.pathname === '/__metrics') {
      if (!requireAuth()) return;
      let out = `# HELP eon_workers Deployed workers\neon_workers ${workers.size}\n`;
      out += `# HELP eon_requests_total Requests per worker\neon_requests_total{runtime="eon"} 0\n`;
      for (const [name, s] of stats) {
        out += `eon_requests_total{worker="${name}"} ${s.requests}\n`;
        out += `eon_errors_total{worker="${name}"} ${s.errors}\n`;
        out += `eon_ai_calls_total{worker="${name}"} ${s.aiCalls || 0}\n`;
        out += `eon_ai_latency_ms_sum{worker="${name}"} ${s.aiLatencyMs || 0}\n`;
        out += `eon_ai_latency_ms_count{worker="${name}"} ${s.aiCalls || 0}\n`;
        out += `eon_do_calls_total{worker="${name}"} ${s.doCalls || 0}\n`;
        out += `eon_do_errors_total{worker="${name}"} ${s.doErrors || 0}\n`;
      }
      for (const q of readdirSync(`${KV_DIR}/__queues`, { withFileTypes: true }).filter(d => d.isDirectory())) {
        let depth = 0;
        try { depth = readdirSync(`${KV_DIR}/__queues/${q.name}`).filter(f => f.endsWith('.json')).length; } catch {}
        out += `eon_queue_depth{queue="${q.name}"} ${depth}\n`;
      }
      out += `eon_durable_objects_total ${doInstances.size}\n`;
      out += `# HELP eon_requests_duration_ms Request latency histogram (max 1000 samples/worker)\n`;
      const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
      for (const [name, samples] of perWorkerLatency) {
        for (const b of buckets) {
          const c = samples.reduce((n, ms) => n + (ms <= b ? 1 : 0), 0);
          out += `eon_requests_duration_ms_bucket{worker="${name}",le="${b}"} ${c}\n`;
        }
        out += `eon_requests_duration_ms_bucket{worker="${name}",le="+Inf"} ${samples.length}\n`;
        out += `eon_requests_duration_ms_count{worker="${name}"} ${samples.length}\n`;
      }
      out += `# HELP eon_event_loop_lag_ms Event-loop lag (ms)\neon_event_loop_lag_ms ${eventLoopLagMs}\n`;
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(out);
      return;
    }
    if (url.pathname === '/__deploy' && req.method === 'POST') {
      if (!requireAuth()) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          workers.delete(data.name);
          doInstances.clear();
          logLine(data.name, 'info', 'deployed', { version: data.version });
          json({ status: 'deployed', name: data.name, version: data.version });
        } catch (e) { json({ error: e.message }, 400); }
      });
      return;
    }
    if (url.pathname === '/__undeploy' && req.method === 'POST') {
      if (!requireAuth()) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          workers.delete(data.name);
          rmSync(`${WORKERS_DIR}/${data.name}`, { recursive: true, force: true });
          json({ status: 'undeployed', name: data.name });
        } catch (e) { json({ error: e.message }, 400); }
      });
      return;
    }
    if (url.pathname === '/__routes') {
      if (!requireAuth()) return;
      const routes = [];
      for (const name of readdirSync(WORKERS_DIR)) { const w = loadWorker(name); if (w) routes.push({ name, version: w.version, crons: w.meta.crons || [] }); }
      json({ routes, count: routes.length });
      return;
    }
    if (url.pathname === '/__kv' && req.method === 'POST') {
      if (!requireAuth()) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const kv = new LocalKV(data.namespace || 'default');
          if (data.action === 'get') json({ value: kv.get(data.key) });
          else if (data.action === 'get_meta') json(kv.getWithMetadata(data.key));
          else if (data.action === 'put') { kv.put(data.key, data.value, data.opts || {}); json({ status: 'ok' }); }
          else if (data.action === 'delete') { kv.delete(data.key); json({ status: 'ok' }); }
          else if (data.action === 'list') json(kv.list(data.opts || {}));
          else json({ error: 'unknown action' }, 400);
        } catch (e) { json({ error: e.message }, 400); }
      });
      return;
    }
    if (url.pathname === '/__scheduled' && req.method === 'POST') {
      if (!requireAuth()) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const name = data.worker || url.searchParams.get('worker');
          const cron = data.cron || url.searchParams.get('cron') || '* * * * *';
          if (!name || !existsSync(`${WORKERS_DIR}/${name}`)) { json({ error: 'unknown worker' }, 404); return; }
          fireScheduled(name, { cron, scheduledTime: new Date().toISOString() })
            .then(() => json({ status: 'fired', worker: name, cron }))
            .catch(e => json({ error: e.message }, 500));
        } catch (e) { json({ error: e.message }, 400); }
      });
      return;
    }
    // Unknown __ endpoint
    json({ error: 'unknown management endpoint' }, 404);
    return;
  }

  // ─── Route to Worker by subdomain ─────────────────────────
  const workerName = subdomain !== 'eon-runtime' ? subdomain : 'default';
  let worker = getOrCreateWorkerModule(workerName);
  if (!worker) {
    const pathWorker = url.pathname.split('/')[1];
    if (pathWorker && pathWorker !== 'favicon.ico') worker = getOrCreateWorkerModule(pathWorker);
  }

  if (!worker) {
    json({
      service: 'EON Worker Runtime',
      version: VERSION,
      domain: '*.eon-mesh.internal → 127.0.0.1',
      workers: readdirSync(WORKERS_DIR).filter(d => existsSync(`${WORKERS_DIR}/${d}/worker.js`) || existsSync(`${WORKERS_DIR}/${d}/current`)),
      manage: { deploy: 'POST /__deploy', routes: 'GET /__routes', kv: 'POST /__kv', health: 'GET /__health', scheduled: 'POST /__scheduled' }
    });
    return;
  }

  // ─── Execute Worker (with body read + timeout + streaming) ─
  bump(workerName, 'req');
  const finish = async () => {
    try {
      const method = req.method;
      const body = req.bodyText || undefined;
      const fwdHeaders = { ...req.headers };
      if (req.headers['x-eon-request-id']) fwdHeaders['x-eon-request-id'] = req.headers['x-eon-request-id'];
      const request = new Request(url.toString(), { method, headers: fwdHeaders, body });
      const response = await callWorker(worker, request);
      bump(workerName, 'ok');
      writeResponse(res, response, reqId);
      logLine(workerName, 'info', `${method} ${url.pathname}`, { reqId, status: response.status, ms: Date.now() - t0 });
      trackLatency(workerName, Date.now() - t0);
    } catch (e) {
      bump(workerName, 'err');
      logLine(workerName, 'error', `${req.method} ${url.pathname}`, { reqId, ms: Date.now() - t0, error: e.message });
      trackLatency(workerName, Date.now() - t0);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'x-eon-request-id': reqId });
        res.end(JSON.stringify({ error: e.message, stack: e.stack?.split('\n').slice(0, 4).join('\n') }));
      } else {
        res.end();
      }
    }
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { req.bodyText = body; finish(); });
  } else {
    finish();
  }
}

const server = createServer(serverListener);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[runtime] EON Worker Runtime v${VERSION} on 127.0.0.1:${PORT}`);
  console.log(`[runtime] Domain: *.eon-mesh.internal → localhost`);
  console.log(`[runtime] Auth: ${AUTH_TOKEN ? 'enabled' : 'disabled (no token file — set via eondeploy start)'}`);
  console.log(`[runtime] Workers: ${WORKERS_DIR} | KV: ${KV_DIR} | Secrets: ${SECRETS_DIR}`);
  console.log(`[runtime] Deploy: eondeploy deploy ./worker.js --name my-worker --local`);
});

// ─── Cron loop (fires ~1s after each minute boundary) ────────
scheduleNextTick();

// ─── HTTPS + Port 80/443 ─────────────────────────────────────
if (ENABLE_HTTPS) {
  const certPath = `${CERTS_DIR}/eon-mesh.crt`;
  const keyPath = `${CERTS_DIR}/eon-mesh.key`;
  if (existsSync(certPath) && existsSync(keyPath)) {
    createServer((req, res) => {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      res.end();
    }).listen(80, '127.0.0.1', () => console.log('[runtime] HTTP :80 → redirect to HTTPS'));
    createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, serverListener)
      .listen(443, '127.0.0.1', () => console.log('[runtime] HTTPS :443 — *.eon-mesh.internal (self-signed)'));
  } else {
    console.warn('[runtime] --https requested but certs missing in ' + CERTS_DIR);
  }
}
