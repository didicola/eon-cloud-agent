#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// EON Worker Runtime — local alternative to Cloudflare Workers
// Serves Workers on *.eon-mesh.internal (127.0.0.1:8787)
// KV, DO emulation, multi-worker routing, hot reload
// ═══════════════════════════════════════════════════════════════
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { createHash } from 'crypto';

const PORT = +process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 8787;
const WORKERS_DIR = '/mnt/fluid-cloud/cloud-opencode/workers';
const KV_DIR = '/mnt/fluid-cloud/cloud-opencode/kv';
const CERTS_DIR = '/mnt/fluid-cloud/cloud-opencode/certs';
const ENABLE_HTTPS = process.argv.includes('--https');

// Ensure dirs exist
if (!existsSync(WORKERS_DIR)) mkdirSync(WORKERS_DIR, { recursive: true });
if (!existsSync(KV_DIR)) mkdirSync(KV_DIR, { recursive: true });

// ─── KV Emulation ────────────────────────────────────────────
class LocalKV {
  constructor(namespace) {
    this.ns = namespace;
    this.dir = `${KV_DIR}/${namespace}`;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }
  get(key) {
    const path = `${this.dir}/${key.replace(/[^a-zA-Z0-9:_-]/g, '_')}`;
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  }
  put(key, value, opts = {}) {
    const path = `${this.dir}/${key.replace(/[^a-zA-Z0-9:_-]/g, '_')}`;
    writeFileSync(path, value);
    if (opts.metadata) {
      writeFileSync(`${path}.meta`, JSON.stringify(opts.metadata));
    }
    if (opts.expirationTtl) {
      // Simulated — in production would set timer
    }
  }
  delete(key) {
    const path = `${this.dir}/${key.replace(/[^a-zA-Z0-9:_-]/g, '_')}`;
    try { rmSync(path); } catch(e) {}
    try { rmSync(`${path}.meta`); } catch(e) {}
  }
  list(opts = {}) {
    const prefix = opts.prefix || '';
    const files = readdirSync(this.dir).filter(f => !f.endsWith('.meta'));
    const keys = files
      .filter(f => f.startsWith(prefix.replace(/[^a-zA-Z0-9:_-]/g, '_')))
      .map(f => ({ name: f }));
    return { keys };
  }
  getWithMetadata(key) {
    const val = this.get(key);
    if (!val) return { value: null, metadata: null };
    const path = `${this.dir}/${key.replace(/[^a-zA-Z0-9:_-]/g, '_')}.meta`;
    const meta = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
    return { value: val, metadata: meta };
  }
}

// ─── Worker Registry ─────────────────────────────────────────
const workers = new Map();  // name -> { module, kv, do }

function loadWorker(name) {
  const dir = `${WORKERS_DIR}/${name}`;
  const jsPath = `${dir}/worker.js`;
  const metaPath = `${dir}/meta.json`;
  if (!existsSync(jsPath)) return null;
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {};
  return { name, dir, meta, jsPath };
}

function getOrCreateWorkerModule(name) {
  const w = loadWorker(name);
  if (!w) return null;
  if (workers.has(name) && !process.argv.includes('--no-cache')) return workers.get(name);

  const kvBindings = {};
  for (const b of (w.meta.kv_bindings || [])) {
    const [bindName, ns] = b.split('=');
    kvBindings[bindName] = new LocalKV(ns || bindName.toLowerCase());
  }

  // Create env with KV bindings
  const env = { ...kvBindings };

  // Load DO classes (exported named classes)
  const doClasses = {};
  for (const b of (w.meta.do_bindings || [])) {
    const [bindName, className] = b.split('=');
    doClasses[bindName] = className;
  }

  // Evaluate the worker module using dynamic import
  try {
    const moduleUrl = new URL(`file://${w.jsPath}`).href;
    const registered = {
      env, doClasses,
      moduleUrl,
      loadModule: async () => {
        if (registered.mod) return registered.mod;
        const cacheBust = `?t=${Date.now()}`;
        const mod = await import(`${moduleUrl}${cacheBust}`);
        registered.mod = mod;
        return mod;
      }
    };
    workers.set(name, registered);
    return registered;
  } catch (e) {
    console.error(`[runtime] Error registering worker ${name}:`, e.message);
    return null;
  }
}

// ─── Auto-deploy from eondeploy ──────────────────────────────
const pendingDeploys = [];

// ─── HTTP Server ─────────────────────────────────────────────
async function serverListener(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const host = req.headers.host || 'localhost';
  const subdomain = host.split('.')[0];

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };

  // ─── Management endpoints ────────────────────────────────
  if (url.pathname === '/__deploy' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        workers.delete(data.name);
        json({ status: 'deployed', name: data.name });
      } catch(e) { json({ error: e.message }, 400); }
    });
    return;
  }

  if (url.pathname === '/__routes') {
    const routes = [];
    for (const [name] of workers) routes.push(name);
    json({ routes, count: routes.length });
    return;
  }

  if (url.pathname === '/__kv' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const kv = new LocalKV(data.namespace || 'default');
        if (data.action === 'get') json({ value: kv.get(data.key) });
        else if (data.action === 'put') { kv.put(data.key, data.value, data.opts || {}); json({ status: 'ok' }); }
        else if (data.action === 'delete') { kv.delete(data.key); json({ status: 'ok' }); }
        else if (data.action === 'list') json(kv.list(data.opts || {}));
        else json({ error: 'unknown action' }, 400);
      } catch(e) { json({ error: e.message }, 400); }
    });
    return;
  }

  // ─── Route to Worker by subdomain ─────────────────────────
  const workerName = subdomain !== 'eon-runtime' ? subdomain : 'default';
  let worker = getOrCreateWorkerModule(workerName);

  // Fallback: try exact worker name from path
  if (!worker) {
    const pathWorker = url.pathname.split('/')[1];
    if (pathWorker && pathWorker !== 'favicon.ico') {
      worker = getOrCreateWorkerModule(pathWorker);
    }
  }

  if (!worker) {
    // Return runtime info instead of 404
    json({
      service: 'EON Worker Runtime',
      version: '3.0.0',
      domain: '*.eon-mesh.internal → 127.0.0.1',
      workers: readdirSync(WORKERS_DIR).filter(d => existsSync(`${WORKERS_DIR}/${d}/worker.js`)),
      manage: { deploy: 'POST /__deploy', routes: 'GET /__routes', kv: 'POST /__kv' }
    });
    return;
  }

  // ─── Execute Worker ──────────────────────────────────────
  const executeWorker = async () => {
    try {
      const mod = await worker.loadModule();
      const defaultExport = mod.default || mod;
      if (!defaultExport || typeof defaultExport.fetch !== 'function') {
        json({ error: 'worker has no fetch handler' }, 500);
        return;
      }
      const request = new Request(url.toString(), {
        method: req.method,
        headers: req.headers
      });
      const response = await defaultExport.fetch(request, worker.env);
      const status = response.status || 200;
      const headers = {};
      if (response.headers && response.headers.forEach) {
        response.headers.forEach((v, k) => headers[k] = v);
      }
      const text = await response.text();
      res.writeHead(status, headers);
      res.end(text);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message, stack: e.stack?.split('\n').slice(0,5).join('\n') }));
    }
  };

  // Read body for non-GET requests then execute
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const mod = await worker.loadModule();
        const defaultExport = mod.default || mod;
        if (!defaultExport || typeof defaultExport.fetch !== 'function') {
          json({ error: 'worker has no fetch handler' }, 500);
          return;
        }
        const request = new Request(url.toString(), {
          method: req.method,
          headers: req.headers,
          body: body.length ? body : undefined
        });
        const response = await defaultExport.fetch(request, worker.env);
        const status = response.status || 200;
        const headers = {};
        if (response.headers && response.headers.forEach) {
          response.headers.forEach((v, k) => headers[k] = v);
        }
        const text = await response.text();
        res.writeHead(status, headers);
        res.end(text);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message, stack: e.stack?.split('\n').slice(0,5).join('\n') }));
      }
    });
  } else {
    executeWorker();
  }
}

const server = createServer(serverListener);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[runtime] EON Worker Runtime on 127.0.0.1:${PORT}`);
  console.log(`[runtime] Domain: *.eon-mesh.internal → localhost`);
  console.log(`[runtime] Workers: ${WORKERS_DIR}`);
  console.log(`[runtime] KV: ${KV_DIR}`);
  console.log(`[runtime] Deploy: eondeploy deploy ./worker.js --name my-worker --local`);
});

// ─── HTTPS + Port 80/443 ─────────────────────────────────────
if (ENABLE_HTTPS) {
  const certPath = `${CERTS_DIR}/eon-mesh.crt`;
  const keyPath = `${CERTS_DIR}/eon-mesh.key`;

  if (existsSync(certPath) && existsSync(keyPath)) {
    // Redirect HTTP :80 → HTTPS
    createServer((req, res) => {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      res.end();
    }).listen(80, '127.0.0.1', () => console.log('[runtime] HTTP :80 → redirect to HTTPS'));

    // HTTPS :443 serves workers
    createHttpsServer({
      cert: readFileSync(certPath),
      key: readFileSync(keyPath)
    }, serverListener).listen(443, '127.0.0.1', () => {
      console.log('[runtime] HTTPS :443 — *.eon-mesh.internal (self-signed)');
    });
  } else {
    console.warn('[runtime] --https requested but certs missing in ' + CERTS_DIR);
    console.warn('[runtime] Generate: openssl req -x509 -newkey rsa:2048 -nodes -keyout eon-mesh.key -out eon-mesh.crt -days 3650 -subj "/CN=*.eon-mesh.internal"');
  }
}
