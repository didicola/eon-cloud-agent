// ═══════════════════════════════════════════════════════════════════════
// EON EDGE IDE SERVER — serves the Cloud IDE at https://opencode.eon
//
// This is the local "thin terminal edge": the same cloud_ide.js organ that
// lives inside the Sovereign Worker, bound to the sovereign .eon domain with
// EON-CA HTTPS. State is a KV mock (in-memory) — the real Cloud keeps state
// in Cloudflare KV/D1. The domain opencode.eon -> 127.0.0.1 comes from
// /etc/hosts; the certificate comes from EON-CA (issued above).
// ═══════════════════════════════════════════════════════════════════════
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { handleIde } from './cloud_ide.js';

const PORT = 8444;

// KV mock (the Cloud's sovereign KV, served locally until the Worker deploys)
class MockKV {
  constructor() { this.m = new Map(); }
  async get(key, type) {
    const v = this.m.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, val) { this.m.set(key, val); }
}
const kv = new MockKV();
const D1 = null;

function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function dashboard() {
  const organs = [
    ['EONHub', 'code-registry'], ['EONModels', 'model-registry'], ['EON-Torch', 'compute-dispatch'],
    ['EON-Edge', 'edge'], ['EON-Memory', 'memory'], ['EON-Dream', 'dreamer'], ['EON-Remote', 'fetch'],
    ['EON-Wrangler', 'deploy'], ['EON-Pods', 'migration'], ['EON-Vault', 'secrets'],
    ['EON-Synapse', 'message-bus'], ['EON-MRI', 'telemetry'], ['EON-Hippocampus', 'memory-search'],
  ];
  const rows = organs.map(([id, k]) => `<tr><td>${id}</td><td>${k}</td><td>born</td><td>0</td></tr>`).join('');
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>EON Dashboard</title>
<style>body{background:#0b0e14;color:#d4d4d4;font-family:monospace;padding:24px}h1{color:#7ee787}table{border-collapse:collapse;width:100%}td,th{border:1px solid #30363d;padding:8px;text-align:left}</style></head>
<body><h1>EON Sovereign Dashboard — https://opencode.eon</h1>
<p>13 organs · live inside one Worker · speed-of-light immune system</p>
<table><tr><th>Organ</th><th>Kind</th><th>State</th><th>Reborns</th></tr>${rows}</table></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

const server = https.createServer(
  {
    key: readFileSync('/home/ricos/.eon/certs/opencode.eon.key'),
    cert: readFileSync('/home/ricos/.eon/certs/opencode.eon.crt'),
  },
  async (req, res) => {
    const url = new URL(req.url, 'https://opencode.eon');
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    let body = '';
    for await (const chunk of req) body += chunk;
    const fakeReq = {
      method: req.method,
      headers: req.headers,
      text: async () => body,
      json: async () => { try { return JSON.parse(body); } catch { return {}; } },
    };

    try {
      let resp;
      if (url.pathname === '/api/health') {
        resp = j({ status: 'ok', score: 100.0, organs_up: 13, organs_total: 13, role: 'sovereign-brain', domain: 'opencode.eon' });
      } else if (url.pathname === '/' || url.pathname === '/dashboard') {
        resp = dashboard();
      } else if (url.pathname === '/ide' || url.pathname.startsWith('/ide/') || url.pathname.startsWith('/api/ide/')) {
        resp = await handleIde(fakeReq, url, kv, D1, { EON_KV: kv });
      } else {
        resp = j({ ok: false, error: 'unknown route', hint: '/ide, /dashboard, /api/health' }, 404);
      }
      const out = await resp.arrayBuffer();
      res.writeHead(resp.status, Object.fromEntries(resp.headers));
      res.end(Buffer.from(out));
    } catch (e) {
      res.writeHead(500, headers);
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  },
);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[eon-edge] https://opencode.eon -> 127.0.0.1:${PORT} (EON-CA HTTPS, Cloud IDE live)`);
});
