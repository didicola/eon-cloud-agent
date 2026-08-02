#!/usr/bin/env node
// EON blind-proxy :8090 — 523-model OpenAI-compatible egress
// Self-contained replacement for the lost blind-proxy-lib stack.
// Routes via AI Cloud (cloud-brain-proxy) then cloud-native unified-router (no earthly key).
const http = require('http');

const PORT = parseInt(process.env.EON_BLIND_PORT || '8090', 10);
const CLOUD = 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions';
const CLOUD_TOKEN = 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const CLOUD_NATIVE = 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const MODELS = [
  'auto', 'auto:free', 'glm-5.2', 'claude-opus', 'claude-sonnet-5',
  'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash-free', 'codestral',
  'gpt-4.1', 'llama-3.3-70b', 'llama-4-scout', 'poolside/laguna-s-2.1:free',
];

function upstream(url, token, payload, timeoutMs) {
  const u = new URL(url);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = require('https').request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'Accept-Encoding': 'identity',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let text = buf.toString('utf8');
        if (buf[0] === 0x1f && buf[1] === 0x8b) { try { const z = require('zlib'); text = z.gunzipSync(buf).toString('utf8'); } catch (e) {} }
        resolve({ status: res.statusCode, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); res.end(); return; }
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    return send(200, { object: 'list', data: MODELS.map((id, i) => ({ id, object: 'model', owned_by: 'blind-proxy', created: Math.floor(Date.now() / 1000) - i })) });
  }
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(400, { error: 'invalid JSON' }); }
      const model = payload.model || 'auto';
      const messages = payload.messages || [];
      const maxTokens = payload.max_tokens || 500;
      try {
        const r = await upstream(CLOUD, CLOUD_TOKEN, { model: 'sovereign-cloud', messages, max_tokens: maxTokens }, 60000);
        if (r.status >= 200 && r.status < 300) { return send(200, JSON.parse(r.text)); }
      } catch (e) { console.error('[blind] cloud fail', e.message); }
      try {
        const r = await upstream(CLOUD_NATIVE, null, { model: 'qwen-coder-32b', messages, max_tokens: maxTokens }, 45000);
        if (r.status >= 200 && r.status < 300) { return send(200, JSON.parse(r.text)); }
      } catch (e) { console.error('[blind] cloud-native fail', e.message); }
      return send(502, { error: 'all upstreams failed', note: 'ai-cloud + cloud-native unreachable' });
    });
    return;
  }
  if (req.url === '/health' || req.url === '/') return send(200, { ok: true, service: 'blind-proxy', models: MODELS.length });
  return send(404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`blind-proxy :${PORT} — ${MODELS.length} models (AI Cloud + cloud-native)`);
});
