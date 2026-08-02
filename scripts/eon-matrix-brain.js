#!/usr/bin/env node
// EON Matrix-Brain — neural matrix registry + delegation engine.
// Discovers, health-checks, and unifies EVERY cloud (AI clouds + web clouds +
// local nodes + external fleet) into ONE neural map, stored in D1 via
// cloud-store (cfg:matrix-brain/map). Exposes:
//   GET  /matrix/map          → full unified neural map (all clouds, all channels)
//   GET  /matrix/health        → quick health summary
//   GET  /matrix/summary       → compact counts
//   POST /matrix/delegate      → {task, need?} → picks best cloud, delegates it
//   GET  /matrix/status        → daemon info + last tick
// Listens on EON_MATRIX_PORT (default 8097).
'use strict';
const http = require('http');
const https = require('https');
const cloudStore = require('./lib/cloud-store.js');

const PORT = parseInt(process.env.EON_MATRIX_PORT || '8097');
const MAP_KEY = 'matrix-brain/map';
const TICK_MS = 60000;
const UA = 'eon-matrix-brain/1.0';

// ─── registry: every node in the matrix ───
const CLOUDS = [
  // AI clouds (compute/brains)
  { id: 'eon-p2p-cloud', kind: 'ai-cloud', base: 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    routes: ['/', '/status', '/v1/models', '/sync/health', '/sync/memory'] },
  { id: 'cloud-brain-proxy', kind: 'ai-cloud', base: 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    routes: ['/', '/v1/models', '/v1/chat/completions'] },
  { id: 'eon-site', kind: 'ai-web', base: 'https://eon-site.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    routes: ['/', '/api/health', '/api/chat'] },
  { id: 'ai-cloud-space', kind: 'store-cloud', base: 'https://ai-cloud-space.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    routes: ['/', '/d1/coord/probe'] },
  { id: 'eon-flarex', kind: 'exit-cloud', base: 'https://eon-flarex.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    routes: ['/', '/api/health'] },
  // web clouds / meshes (dead-but-intended)
  { id: 'eon-round-matrix', kind: 'web-cloud', base: 'https://eon-round-matrix.pleasant-bobble.workers.dev',
    routes: ['/', '/v3', '/brain/health', '/router/peers'] },
  { id: 'eon-mesh-swarm', kind: 'web-cloud', base: 'https://eon-mesh-swarm.pleasant-bobble.workers.dev',
    routes: ['/', '/peers', '/mesh/peers'] },
];

const EXTERNAL_FLEET = [
  { id: 'pollinations', kind: 'external-ai', url: 'https://text.pollinations.ai/openai', health: 'https://text.pollinations.ai/openai' },
  { id: 'huggingface', kind: 'external-ai', url: 'https://huggingface.co', health: 'https://huggingface.co' },
];

const LOCAL_NODES = [
  { id: 'node5-eon-pages', kind: 'local-web', host: '127.0.0.1', port: 8080, path: '/hf/' },
  { id: 'node5-blind-proxy', kind: 'local-ai', host: '127.0.0.1', port: 8090, path: '/v1/models' },
  { id: 'node5-eon-blind-proxy', kind: 'local-ai', host: '127.0.0.1', port: 8092, path: '/v1/models' },
  { id: 'node5-matrix-brain', kind: 'local-ai', host: '127.0.0.1', port: 8201, path: '/health' },
  { id: 'node5-matrix-relay', kind: 'local-relay', host: '127.0.0.1', port: 8095, path: '/status' },
];

// ─── helpers ───
function log() { console.log('[' + new Date().toISOString().replace('T',' ').slice(0,19) + ' UTC] [matrix-brain]', ...arguments); }

function fetchUrl(urlStr, timeoutMs) {
  return new Promise((resolve) => {
    let u; try { u = new URL(urlStr); } catch (e) { resolve({ ok: false, err: 'bad-url' }); return; }
    const mod = u.protocol === 'https:' ? https : http;
    const t = Date.now();
    const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': UA, 'Connection': 'close' } };
    let done = false;
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        done = true;
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, code: res.statusCode, ms: Date.now() - t, body: data });
      });
    });
    req.setTimeout(timeoutMs || 8000, () => { req.destroy(); if (!done) { done = true; resolve({ ok: false, err: 'timeout' }); } });
    req.on('error', (e) => { if (!done) { done = true; resolve({ ok: false, err: String(e.code || e).slice(0, 60) }); } });
    req.end();
  });
}

async function probe(entry) {
  if (entry.kind === 'local-web' || entry.kind === 'local-ai' || entry.kind === 'local-relay') {
    const r = await fetchUrl('http://' + entry.host + ':' + entry.port + (entry.path || '/'), 4000);
    return { ...entry, up: r.ok, code: r.code || null, ms: r.ms || null, err: r.err || null, checked: Date.now() };
  }
  // cloud: probe every route, any 200 wins
  const results = [];
  for (const route of entry.routes || []) {
    const r = await fetchUrl(entry.base + route, 8000);
    results.push({ route, ok: r.ok, code: r.code, ms: r.ms, err: r.err });
  }
  const okAny = results.some(r => r.ok);
  const best = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms)[0] || null;
  return { ...entry, up: okAny, routes: results, bestRoute: best ? best.route : null, bestMs: best ? best.ms : null, checked: Date.now() };
}

async function tick() {
  log('tick: probing', CLOUDS.length, 'clouds +', EXTERNAL_FLEET.length, 'external +', LOCAL_NODES.length, 'local nodes');
  const cloudProbes = await Promise.all(CLOUDS.map(probe));
  const extProbes = await Promise.all(EXTERNAL_FLEET.map(async (e) => {
    const r = await fetchUrl(e.health, 8000);
    return { ...e, up: r.ok, code: r.code || null, ms: r.ms || null, err: r.err || null, checked: Date.now() };
  }));
  const localProbes = await Promise.all(LOCAL_NODES.map(probe));

  const map = {
    generated: new Date().toISOString(),
    brain: { node: 'node5', port: PORT, version: '1.0.0' },
    totals: {
      clouds: cloudProbes.filter(c => c.up).length,
      cloudTotal: cloudProbes.length,
      externalUp: extProbes.filter(c => c.up).length,
      localUp: localProbes.filter(c => c.up).length,
      localTotal: localProbes.length,
      totalUp: cloudProbes.filter(c => c.up).length + extProbes.filter(c => c.up).length + localProbes.filter(c => c.up).length,
    },
    ai_clouds: cloudProbes.filter(c => c.kind === 'ai-cloud'),
    web_clouds: cloudProbes.filter(c => c.kind === 'web-cloud'),
    store_clouds: cloudProbes.filter(c => c.kind === 'store-cloud'),
    exit_clouds: cloudProbes.filter(c => c.kind === 'exit-cloud'),
    external_fleet: extProbes,
    local_nodes: localProbes,
    channels: [
      { name: 'delegate', ok: true, desc: '/delegate/to-local + /delegate/to-cloud (eon-p2p-cloud)' },
      { name: 'sync-config-kv', ok: false, desc: '/sync/config (ai-cloud-space KV — daily write limit)' },
      { name: 'sync-memory-d1', ok: true, desc: '/sync/memory (ai-cloud-space D1 — unlimited, permanent)' },
      { name: 'upgrade', ok: true, desc: '/upgrade/propose (self-upgrade channel)' },
      { name: 'mesh', ok: false, desc: 'eon-mesh-swarm (built, not deployed)' },
    ],
  };
  state.map = map;
  state.lastTick = Date.now();

  // persist to D1 (permanent brain store, twin-readable)
  const r = await cloudStore.put('matrix', MAP_KEY, JSON.stringify(map));
  log('map persisted to D1: kv=' + r.kvOk + ' mem=' + r.memOk + ' totals=' + JSON.stringify(map.totals));
  return map;
}

// ─── state ───
const state = { map: null, lastTick: null, starting: Date.now() };

// ─── delegation decision engine ───
function decideDelegate(task) {
  const t = (task || '').toLowerCase();
  const map = state.map;
  if (!map) return { ok: false, err: 'matrix map not built yet' };

  const aiClouds = map.ai_clouds.filter(c => c.up);
  const external = map.external_fleet.filter(c => c.up);
  const local = map.local_nodes.filter(c => c.up && (c.kind === 'local-ai'));

  // brainwork (chat/reason/code) → strongest AI cloud + external fallback
  if (/(chat|reason|think|code|write|answer|explain|solve)/.test(t) || !t) {
    const chain = [
      ...aiClouds.map(c => ({ node: c.id, kind: c.kind, score: (c.bestMs ? Math.max(0, 100 - c.bestMs / 10) : 50) })),
      ...external.map(c => ({ node: c.id, kind: c.kind, score: 40 })),
      ...local.map(c => ({ node: c.id, kind: c.kind, score: 60 })),
    ].sort((a, b) => b.score - a.score);
    return { ok: true, decision: 'brainwork', chain, primary: chain[0], note: 'route chat/reason via strongest brain, fallback down the chain' };
  }
  // storage (save/recall/store) → D1 store cloud
  if (/(save|store|recall|memory|put|push|sync)/.test(t)) {
    return { ok: true, decision: 'storage', primary: { node: 'ai-cloud-space', kind: 'store-cloud', note: 'D1 (unlimited) via /sync/memory' }, chain: [{ node: 'ai-cloud-space', score: 100 }] };
  }
  // deploy (host/serve/site) → web cloud + local pages
  if (/(deploy|host|serve|site|publish)/.test(t)) {
    const chain = [
      ...aiClouds.filter(c => c.kind === 'ai-web').map(c => ({ node: c.id, kind: c.kind, score: 90 })),
      ...map.local_nodes.filter(c => c.kind === 'local-web' && c.up).map(c => ({ node: c.id, kind: c.kind, score: 70 })),
    ];
    return { ok: true, decision: 'deploy', primary: chain[0] || { node: 'node5-eon-pages', kind: 'local-web', score: 70 }, chain };
  }
  // egress (browse/exit/clean-ip) → flarex exit cloud
  if (/(browse|egress|exit|clean|ip|flarex)/.test(t)) {
    return { ok: true, decision: 'egress', primary: { node: 'eon-flarex', kind: 'exit-cloud', note: 'clean-IP exit proxy' }, chain: [{ node: 'eon-flarex', score: 90 }] };
  }
  return { ok: true, decision: 'unknown', primary: null, note: 'no matching intent', chain: [] };
}

// ─── HTTP ───
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj, null, 2)); };
  try {
    if (req.method === 'POST' && u.pathname === '/matrix/delegate') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        let task = null;
        try { task = JSON.parse(body || '{}').task; } catch (e) {}
        send(200, decideDelegate(task));
      });
      return;
    }
    if (u.pathname === '/matrix/map') return send(200, state.map || { status: 'building' });
    if (u.pathname === '/matrix/summary') {
      const m = state.map;
      return send(200, m ? { status: 'ok', generated: m.generated, totals: m.totals, brain: m.brain } : { status: 'building' });
    }
    if (u.pathname === '/matrix/status') return send(200, { status: 'ok', uptime: Date.now() - state.starting, lastTick: state.lastTick, port: PORT, node: 'node5' });
    if (u.pathname === '/health' || u.pathname === '/') return send(200, { status: 'ok', service: 'eon-matrix-brain', node: 'node5', port: PORT });
    send(404, { error: 'not found' });
  } catch (e) { send(500, { error: e.message }); }
});

// ─── start ───
tick().then(() => setInterval(tick, TICK_MS));
server.listen(PORT, () => log('EON Matrix-Brain :' + PORT + ' — neural matrix registry live'));
process.on('unhandledRejection', (e) => log('unhandledRejection', (e && e.message) || e));
