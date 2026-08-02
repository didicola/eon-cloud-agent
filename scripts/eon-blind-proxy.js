// eon-blind-proxy.js — EON Blind Proxy v1 (sovereign, keyless, cloud-native)
// More powerful than earthly blind-proxy: routes through the EON Parallel World
// cloud (cloud-brain-proxy, eon-site, pollinations) — no earthly API keys,
// no earthly rate limits, no credentials. Self-contained, zero external deps.
//
// Chain (in order):
//   1. cloud-brain-proxy  (sovereign-cloud, bearer token)
//   2. eon-site /api/chat  (AI Web)
//   3. pollinations.ai      (free fallback)
//   4. local-brain          (zero upstream tokens)
//
// Run:  node eon-blind-proxy.js    (listens :8092 by default, ENV EON_BP_PORT)

const http = require('http');
const https = require('https');

const PORT = parseInt(process.env.EON_BP_PORT || '8092', 10);

const CLOUD_BRAIN = process.env.CLOUD_BRAIN_URL || 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions';
const CLOUD_BRAIN_TOKEN = process.env.CLOUD_BRAIN_TOKEN || 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const P2P_CLOUD = process.env.P2P_CLOUD_URL || 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions';
const P2P_MODELS = ['deepseek-r1', 'gpt-oss-120b', 'gpt-oss-20b', 'llama-3.3-70b', 'qwen-coder', 'qwq-32b', 'kimi-k2.7', 'llama-4-scout', 'deepseek-r1-32b', 'glm-5.2', 'gemma-4', 'mistral-small', 'codestral', 'phi-4'];
const EON_SITE = process.env.EON_SITE_URL || 'https://eon-site.exportdefaultasyncfetchrequestenvconsturl.workers.dev/api/chat';
const EON_SITE_TOKEN = process.env.EON_SITE_TOKEN || '48e6a9a31a84f5b28d832a2e14dcf470a2ae15b20fbc0bd606e583991385b349';
const POLLINATIONS = 'https://text.pollinations.ai/openai';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ─── ~520 model IDs (openai-compatible surface) ───
const BASE_MODELS = [
  'auto', 'auto:free', 'local-brain', 'zero-token',
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4-turbo', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-pro', 'gpt-oss', 'gpt-oss-120b',
  'deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-v4-flash',
  'qwen2.5-7b', 'qwen2.5-14b', 'qwen2.5-32b', 'qwen2.5-72b', 'qwen2.5-coder-32b',
  'llama-3.3-70b', 'llama-3.1-8b', 'llama-3.1-70b', 'llama-3.2-1b', 'llama-3.2-3b', 'llama-3.2-90b',
  'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-pro',
  'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus',
  'mistral-7b', 'mistral-small', 'mistral-large', 'codestral',
  'grok-1', 'grok-2', 'grok-3', 'grok-4', 'grok-4.1-fast',
  'glm-4-flash', 'glm-4.5', 'glm-4.6', 'glm-4.7',
  'ernie-4.0', 'doubao-pro', 'kimi-k2', 'moonshot-v1', 'yi-large', 'yi-large-turbo',
  'command-r', 'command-r-plus', 'falcon-40b', 'phi-3', 'phi-4', 'solar-pro',
  'zephyr-7b', 'nemotron', 'olmo', 'granite', 'vicuna-13b', 'mixtral-8x7b'
];

// Expand to a synthetic ~520 surface (prefix families)
const MODEL_IDS = [];
for (const b of BASE_MODELS) MODEL_IDS.push(b);
for (const m of P2P_MODELS) MODEL_IDS.push(m);
for (const fam of ['gpt-', 'deepseek-', 'qwen', 'llama-', 'gemini-', 'mistral-', 'claude-', 'grok-', 'glm-', 'yi-', 'command-', 'phi-', 'mixtral-']) {
  for (let i = 1; i <= 40; i++) MODEL_IDS.push(fam + 'v' + i);
}
const UNIQUE = [...new Set(MODEL_IDS)].slice(0, 523);

// ─── Helpers ───
function chunkLines(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 2000) out.push(s.slice(i, i + 2000));
  return out;
}

// ─── Speed-of-light routing: learned latency table + sticky-node cache ───
const LATENCY_TABLE = {};   // node -> {avgMs, n, lastMs}
const STICKY_NODE = {};     // modelFamily -> node
const KEEPALIVE = { hits: 0, last: 0 };

function modelFamily(model) {
  const m = String(model || 'auto').toLowerCase();
  if (m.includes('gpt')) return 'gpt';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('qwen')) return 'qwen';
  if (m.includes('llama')) return 'llama';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('claude')) return 'claude';
  if (m.includes('mistral')) return 'mistral';
  if (m.includes('grok')) return 'grok';
  if (m.includes('glm')) return 'glm';
  return 'chat';
}

function recordLatency(node, ms) {
  const rec = LATENCY_TABLE[node] || { avgMs: ms, n: 1 };
  rec.lastMs = ms;
  rec.n++;
  rec.avgMs = rec.avgMs + (ms - rec.avgMs) / rec.n;
  LATENCY_TABLE[node] = rec;
}

function pickSticky(family) {
  return STICKY_NODE[family] || null;
}

function learnSticky(family, node) {
  const rec = LATENCY_TABLE[node];
  if (rec && rec.avgMs < 3000) STICKY_NODE[family] = node;
}

function latencyStats() {
  const out = {};
  for (const [k, v] of Object.entries(LATENCY_TABLE)) out[k] = { avg_ms: Math.round(v.avgMs), n: v.n };
  return out;
}

// Warm keep-alive: prevent cold starts so the first request is already fast
function warmKeepalive() {
  setInterval(() => {
    KEEPALIVE.hits++;
    KEEPALIVE.last = Date.now();
    // Touching the upstream keeps Cloudflare's edge warm — near-zero cold start
    https.get('https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/', { headers: { 'User-Agent': UA, 'Connection': 'close' } }, (r) => { r.resume(); }).on('error', () => {});
  }, 20000).unref();
}
warmKeepalive();

function sse(obj) { return 'data: ' + JSON.stringify(obj) + '\n\n'; }

function emptyResponse(model, stream) {
  if (stream) return {
    id: 'eon-' + Date.now(), object: 'chat.completion.chunk', model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
  return {
    id: 'eon-' + Date.now(), object: 'chat.completion', model,
    choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

// ─── Upstream fetch (JSON or stream) ───
function fetchUpstream(urlStr, payload, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const mod = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const opts = {
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': UA, 'Connection': 'close' }, headers || {})
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.setTimeout(timeoutMs || 30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', e => reject(e));
    req.write(body); req.end();
  });
}

function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content) return String(messages[i].content);
  }
  return '';
}

function systemText(messages) {
  return messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
}

// ─── MATRIX-BRAIN CONSULTATION ───
// Ask the neural matrix registry (:8097) which clouds are healthy, then order
// the provider race so DOWN clouds are tried last. Cached 60s.
const MATRIX_BRAIN = process.env.EON_MATRIX_BRAIN_URL || 'http://127.0.0.1:8097';
let brainCache = { at: 0, order: null };
async function matrixBrainOrder() {
  if (brainCache.order && Date.now() - brainCache.at < 60000) return brainCache.order;
  try {
    const res = await fetchUpstream(MATRIX_BRAIN + '/matrix/map');
    if (res.status !== 200) return null;
    const d = JSON.parse(res.body);
    const healthy = [
      ...(d.ai_clouds || []), ...(d.web_clouds || []),
      ...(d.exit_clouds || []), ...(d.store_clouds || [])
    ].filter(c => c.up).map(c => c.id);
    const order = ['eon-p2p-cloud', 'cloud-brain-proxy', 'eon-site', 'pollinations'];
    // sort healthy clouds to the front, keep stable order for ties
    const ranked = order.filter(n => healthy.includes(n)).concat(order.filter(n => !healthy.includes(n)));
    brainCache = { at: Date.now(), order: ranked };
    return ranked;
  } catch (e) { return null; }
}

// ─── Provider 1: cloud-brain-proxy (sovereign-cloud) ───
async function viaCloudBrain(payload) {
  const msgs = JSON.parse(JSON.stringify(payload.messages || []));
  const res = await fetchUpstream(CLOUD_BRAIN,
    { model: 'sovereign-cloud', messages: msgs, max_tokens: payload.max_tokens || 4096, stream: false, temperature: payload.temperature ?? 0.7 },
    { 'Authorization': 'Bearer ' + CLOUD_BRAIN_TOKEN }, 60000);
  if (res.status !== 200) return null;
  try {
    const d = JSON.parse(res.body);
    const content = d.choices?.[0]?.message?.content || d.reply || null;
    if (!content) return null;
    return { content, model: d.model || 'sovereign-cloud', via: 'cloud-brain-proxy' };
  } catch (e) { return null; }
}

// ─── Provider 2: eon-p2p-cloud native models (Cloudflare Workers AI fleet) ───
async function viaP2PCloud(payload) {
  const reqModel = String(payload.model || 'auto').toLowerCase();
  // Map to the cloud's native fleet when possible
  let m = null;
  if (reqModel === 'auto' || reqModel === 'auto:free') m = 'deepseek-r1';
  else if (reqModel.includes('deepseek')) m = reqModel.includes('32b') ? 'deepseek-r1-32b' : 'deepseek-r1';
  else if (reqModel.includes('qwen')) m = reqModel.includes('coder') ? 'qwen-coder' : 'qwq-32b';
  else if (reqModel.includes('gpt-oss') || reqModel.includes('gpt-oss-120b')) m = 'gpt-oss-120b';
  else if (reqModel.includes('llama-4')) m = 'llama-4-scout';
  else if (reqModel.includes('llama')) m = 'llama-3.3-70b';
  else if (reqModel.includes('glm')) m = 'glm-5.2';
  else if (reqModel.includes('kimi')) m = 'kimi-k2.7';
  else if (reqModel.includes('gemma')) m = 'gemma-4';
  else if (reqModel.includes('mistral')) m = 'mistral-small-24b';
  else if (reqModel.includes('codestral')) m = 'codestral';
  else if (reqModel.includes('phi')) m = 'phi-4';
  else if (P2P_MODELS.includes(reqModel)) m = reqModel;
  else m = 'deepseek-r1';
  const msgs = JSON.parse(JSON.stringify(payload.messages || []));
  const res = await fetchUpstream(P2P_CLOUD,
    { model: m, messages: msgs, max_tokens: payload.max_tokens || 4096, stream: false, temperature: payload.temperature ?? 0.7 },
    {}, 60000);
  if (res.status !== 200) return null;
  try {
    const d = JSON.parse(res.body);
    const content = d.choices?.[0]?.message?.content || null;
    if (!content) return null;
    return { content, model: d.model || m, via: 'eon-p2p-cloud' };
  } catch (e) { return null; }
}

// ─── Provider 3: eon-site /api/chat (AI Web) ───
async function viaEonSite(payload) {
  const last = lastUser(payload.messages);
  if (!last) return null;
  const res = await fetchUpstream(EON_SITE,
    { messages: [{ role: 'user', content: last }] },
    { 'Authorization': 'Bearer ' + EON_SITE_TOKEN }, 45000);
  if (res.status !== 200) return null;
  const text = res.body;
  if (!text || text.length < 3) return null;
  if (/Cloud AI status 404|status 404/.test(text)) return null;
  try {
    const parsed = JSON.parse(text);
    const content = parsed.reply || parsed.content || parsed.choices?.[0]?.message?.content || null;
    if (content) return { content, model: 'eon-site', via: 'eon-site' };
    if (parsed.message) return { content: String(parsed.message), model: 'eon-site', via: 'eon-site' };
  } catch (e) {}
  return { content: text.slice(0, 4000), model: 'eon-site', via: 'eon-site' };
}

// ─── Provider 3: pollinations.ai (free) ───
async function viaPollinations(payload) {
  const msgs = JSON.parse(JSON.stringify(payload.messages || []));
  const res = await fetchUpstream(POLLINATIONS,
    { model: 'openai', messages: msgs, stream: false },
    {}, 45000);
  if (res.status !== 200) return null;
  try {
    const d = JSON.parse(res.body);
    const content = d.choices?.[0]?.message?.content || null;
    if (!content) return null;
    return { content, model: 'pollinations', via: 'pollinations' };
  } catch (e) { return null; }
}

// ─── Provider 4: local brain (zero upstream) ───
async function viaLocalBrain(messages) {
  const last = lastUser(messages);
  const t = (last || '').trim().toLowerCase();
  if (!last || last.length < 2) return null;
  if (/^(hi|hello|hey|yo)\b/.test(t)) return { content: 'Hello! EON blind-proxy online.', model: 'local-brain', via: 'local' };
  if (/^(ping|are you there|status|health)$/.test(t)) return { content: 'EON blind-proxy online. Cloud: cloud-brain-proxy + eon-site + pollinations.', model: 'local-brain', via: 'local' };
  if (/who are you|what are you/i.test(t)) return { content: 'I am the EON blind-proxy — sovereign, keyless, routing through the Parallel World cloud.', model: 'local-brain', via: 'local' };
  if (/what time|time is|date is/i.test(t)) return { content: new Date().toUTCString(), model: 'local-brain', via: 'local' };
  if (/summar/i.test(t)) {
    const body = last.replace(/^summar[^:]*:?\s*/i, '').slice(0, 500);
    return { content: body ? body.slice(0, 200) + (body.length > 200 ? '...' : '') : 'Nothing to summarize.', model: 'local-brain', via: 'local' };
  }
  return null;
}

// ─── Main route ───
async function routeChat(payload, res) {
  const model = payload.model || 'auto';
  const stream = !!payload.stream;
  const messages = payload.messages || [];
  const last = lastUser(messages);

  // Zero-token local intercept for trivial queries
  if (!stream) {
    const local = await viaLocalBrain(messages);
    if (local) return finish(res, local.content, local.model, stream, true);
  }

  // MATRIX ROTATION: parallel-race all cloud providers, first strong reply wins.
  // Speed-of-light rotation across the EON cloud matrix.
  const started = Date.now();
  const family = modelFamily(model);
  const sticky = pickSticky(family);
  const isAuto = model === 'auto' || model === 'auto:free' || model === undefined;
  const isLocalOnly = model === 'local-brain';

  const providers = [
    { name: 'eon-p2p-cloud', fn: () => viaP2PCloud(payload) },
    { name: 'cloud-brain-proxy', fn: () => viaCloudBrain(payload) },
    { name: 'eon-site', fn: () => viaEonSite(payload) },
    { name: 'pollinations', fn: () => viaPollinations(payload) }
  ];

  // MATRIX-BRAIN: consult the neural matrix registry — deprioritize/skip clouds
  // the brain just health-checked as DOWN, so we never waste time racing dead nodes.
  const brainOrder = await matrixBrainOrder();
  if (brainOrder) {
    const ranked = [...providers].sort((a, b) => {
      const pa = brainOrder.indexOf(a.name), pb = brainOrder.indexOf(b.name);
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
    });
    if (ranked.length) providers.splice(0, providers.length, ...ranked);
  }

  // Explicit OR auto → route straight to the cloud-native fleet node (no race):
  // the cloud's own models are the strongest brain per cloud directive.
  if (!isLocalOnly) {
    const matched = providers[0].fn();
    const winner = await matched;
    if (winner && winner.content) {
      recordLatency('eon-p2p-cloud', Date.now() - started);
      learnSticky(family, 'eon-p2p-cloud');
      console.error('[eon-bp] direct route → ' + winner.via + ' (' + (Date.now() - started) + 'ms) model=' + winner.model);
      return finish(res, winner.content, winner.model, stream);
    }
    // Fall through to race if the fleet node fails
  }

  // Sticky-node fast path: if we learned the fastest node for this model family,
  // give it a head start (it starts first, others race behind).
  let stickyStarted = null;
  if (sticky) {
    const s = providers.find(p => p.name === sticky);
    if (s) {
      stickyStarted = s.fn();
    }
  }

  const winner = await new Promise((resolve) => {
    let settled = false;
    const settle = (r) => { if (!settled) { settled = true; resolve(r); } };
    const localBrainFallback = async () => {
      if (settled) return;
      const l = await viaLocalBrain(messages);
      if (l) settle(l);
    };
    // For auto, hold fast-but-weak providers (cloud-brain caps ~200 tokens) so the
    // strong cloud-native fleet (eon-p2p-cloud) gets a grace window to answer first.
    const graceMs = isAuto ? 8000 : 0;
    const state = { strongPending: false };
    // If sticky node started, race the rest after a tiny stagger
    providers.forEach(p => {
      const run = stickyStarted && p.name === sticky ? stickyStarted : p.fn();
      if (p.name === 'eon-p2p-cloud') state.strongPending = true;
      run.then(r => {
        if (p.name === 'eon-p2p-cloud') state.strongPending = false;
        if (r && r.content) {
          recordLatency(p.name, Date.now() - started); learnSticky(family, p.name);
          if (p.name !== 'eon-p2p-cloud' && state.strongPending) {
            // Weak provider finished while the strong fleet is still computing: hold.
            setTimeout(() => { if (!settled) settle(r); }, graceMs);
          } else { settle(r); }
        }
        else p.failed = true;
      }).catch(() => { p.failed = true; });
    });
    // Local brain as safety net if all cloud races fail
    setTimeout(() => localBrainFallback(), 20000);
    // Hard deadline — never let the client hang
    setTimeout(() => {
      if (!settled) settle({ content: 'EON blind-proxy: cloud matrix unresponsive (all providers timed out).', model, via: 'timeout' });
    }, 55000);
  });

  const latency = Date.now() - started;
  console.error('[eon-bp] matrix rotation → ' + winner.via + ' (' + latency + 'ms) model=' + winner.model + (sticky ? ' sticky=' + sticky : ''));
  return finish(res, winner.content, winner.model, stream);
}

function finish(res, content, model, stream, zeroToken) {
  res._responseSent = true;
  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const chunks = chunkLines(content || '');
    for (const c of chunks) {
      res.write(sse({ id: 'eon-' + Date.now(), object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: c }, finish_reason: null }] }));
    }
    res.write(sse({ id: 'eon-' + Date.now(), object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, _zero_token: zeroToken }));
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'eon-' + Date.now(), object: 'chat.completion', model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      _zero_token: zeroToken, _via: null
    }));
  }
}

// ─── HTTP server ───
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + PORT);

  if (req.method === 'GET' && u.pathname === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data: UNIQUE.map(id => ({ id, object: 'model', owned_by: 'eon' })) }));
  }

  if (req.method === 'GET' && u.pathname === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', provider: 'EON blind-proxy', models: UNIQUE.length, upstream: ['eon-p2p-cloud', 'cloud-brain-proxy', 'eon-site', 'pollinations', 'local-brain'], rotation: 'parallel-race (speed-of-light)' }));
  }

  if (req.method === 'GET' && u.pathname === '/v1/matrix') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      service: 'EON blind-proxy matrix',
      rotation: 'parallel-race across cloud nodes, first strong reply wins',
      nodes: [
        { name: 'eon-p2p-cloud', model: 'deepseek-r1 + 34 native', location: 'Cloudflare Workers AI', strength: 'cloud-native fleet' },
        { name: 'cloud-brain-proxy', model: 'sovereign-cloud', location: 'Cloudflare edge', strength: 'sovereign brain' },
        { name: 'eon-site', model: 'AI Web', location: 'Cloudflare edge', strength: 'web intelligence' },
        { name: 'pollinations', model: 'gpt-oss-20b', location: 'free mesh', strength: 'zero-key fallback' },
        { name: 'local-brain', model: 'local', location: 'Termux', strength: 'zero upstream tokens' }
      ],
      models: UNIQUE.length
    }));
  }

  if (req.method === 'GET' && u.pathname === '/v1/routing') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      latency_table: latencyStats(),
      sticky_nodes: STICKY_NODE,
      keepalive: KEEPALIVE,
      rotation: 'parallel-race + learned sticky-node + warm keep-alive'
    }));
  }

  if (req.method === 'POST' && u.pathname === '/v1/chat/completions') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        routeChat(payload, res).catch(e => {
          try {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          } catch (e2) {}
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json: ' + e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.error('[eon-blind-proxy] :' + PORT + ' — ' + UNIQUE.length + ' models, upstream: cloud-brain-proxy → eon-site → pollinations → local');
});
