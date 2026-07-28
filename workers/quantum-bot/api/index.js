// EON Quantum Cloud Bot v5.0 — Webhook + Quantum Matrix Intelligence
const https = require('https');
const http = require('http');

const BOT_TOKEN = '8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow';
const CHAT_ID = '6663994526';
const CLOUD_BRAIN = 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const CLOUD_BRAIN_TOKEN = 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const EON_P2P = 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev';

const REGIONS = {
  cortex:      { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.3,  model: 'sovereign-cloud' },
  hippocampus: { url: EON_P2P,     token: null,              weight: 0.2,  model: 'mistral-small' },
  thalamus:    { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.15, model: 'sovereign-cloud' },
  prefrontal:  { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.2,  model: 'sovereign-cloud' },
  limbic:      { url: EON_P2P,     token: null,              weight: 0.1,  model: 'mistral-small' },
  brainstem:   { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.05, model: 'sovereign-cloud' },
};

let stats = { messages: 0, errors: 0, uptime: Date.now(), regions_hit: {} };

function log(level, msg, data) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = { info: '→', warn: '⚠', err: '✗', ok: '✓', think: '🧠' }[level] || '·';
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}] ${prefix} ${msg}${extra}`);
}

function fetchJSON(url, options) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: options.method || 'GET', headers: options.headers || {},
      timeout: 25000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function tgApi(method, data) {
  return fetchJSON(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

function quantumHash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return Math.abs(h) / 2147483647;
}

async function callWorker(url, token, model, prompt, maxTokens = 300) {
  try {
    const headers = {
      'User-Agent': 'EonBrainChain/3.1 (Node.js)',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetchJSON(`${url}/v1/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
    });
    return r?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

async function quantumThink(prompt) {
  const names = Object.keys(REGIONS);
  const selected = names.sort(() => Math.random() - 0.5).slice(0, 3);
  log('think', `Superposition: ${selected.join(', ')}`);

  const start = Date.now();
  const results = await Promise.all(selected.map(async region => {
    const cfg = REGIONS[region];
    const t0 = Date.now();
    const content = await callWorker(cfg.url, cfg.token, cfg.model, `[${region.toUpperCase()}] ${prompt}`, 200);
    const ms = Date.now() - t0;
    const ok = content && content.length > 10;
    log(ok ? 'ok' : 'warn', `Region ${region}: ${ok ? content.length + ' chars' : 'FAIL'} (${ms}ms)`);
    stats.regions_hit[region] = (stats.regions_hit[region] || 0) + (ok ? 1 : 0);
    return { region, content };
  }));

  const valid = results.filter(r => r.content && r.content.length > 10);
  if (!valid.length) { log('err', 'All regions failed'); return '[quantum] All regions failed'; }

  const scored = valid.map(r => {
    const w = REGIONS[r.region]?.weight || 0.1;
    return { ...r, amp: w + quantumHash(r.content || '') * w };
  }).sort((a, b) => b.amp - a.amp);

  const texts = scored.map(s => `[${s.region}] ${s.content}`);
  log('think', 'Collapse: synthesizing via cloud-brain...');
  const synth = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud',
    `Synthesize:\n${texts.map(t => '---\n' + (t||'').slice(0, 500)).join('\n')}`, 500);

  const total = Date.now() - start;
  log('ok', `Quantum think complete (${total}ms, ${valid.length}/${selected.length} regions)`);
  return `⚡ ${synth || scored[0].content}`;
}

async function handleMessage(text, chatId) {
  const t0 = Date.now();
  const cmd = text.startsWith('/') ? text.split(' ')[0].toLowerCase() : '';
  const args = text.slice(cmd.length).trim();

  if (cmd === '/start' || cmd === '/help') {
    await tgApi('sendMessage', { chat_id: chatId, text: 'EON Quantum Cloud Bot\n\n/quantum <q> - quantum reasoning\n/debate <q> - thesis/antithesis\n/status - health\n\nOr type any message.' });
  } else if (cmd === '/version') {
    await tgApi('sendMessage', { chat_id: chatId, text: 'EON v5.0-quantum-cloud | Cloud-native' });
  } else if (cmd === '/status') {
    const uptime = Math.floor((Date.now() - stats.uptime) / 60000);
    const top = Object.entries(stats.regions_hit).sort((a,b) => b[1]-a[1]).slice(0,3).map(([k,v]) => `${k}:${v}`).join(' ');
    await tgApi('sendMessage', { chat_id: chatId, text: `Regions: ${Object.keys(REGIONS).length} | Messages: ${stats.messages} | Uptime: ${uptime}m | Top: ${top}` });
  } else if (cmd === '/quantum') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /quantum <question>' }); return; }
    const r = await quantumThink(args);
    await tgApi('sendMessage', { chat_id: chatId, text: r.slice(0, 4000) });
  } else {
    const r = await quantumThink(text);
    await tgApi('sendMessage', { chat_id: chatId, text: r.slice(0, 4000) });
  }

  log('ok', `Replied in ${Date.now() - t0}ms`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        const msg = update.message;
        if (msg?.text && msg?.chat?.id?.toString() === CHAT_ID) {
          stats.messages++;
          const preview = msg.text.length > 60 ? msg.text.slice(0, 60) + '...' : msg.text;
          log('info', `IN [${msg.from?.first_name || '?'}]: ${preview}`);
          handleMessage(msg.text, msg.chat.id).catch(e => {
            stats.errors++;
            log('err', `handleMessage failed: ${e.message}`);
          });
        } else if (msg) {
          log('warn', `Ignored message from chat ${msg.chat?.id}`);
        }
      } catch (e) {
        stats.errors++;
        log('err', `Parse error: ${e.message}`);
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '5.0-quantum-cloud', regions: Object.keys(REGIONS).length, stats }));
    return;
  }

  if (url.pathname === '/logs') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Check terminal or /health for stats');
    return;
  }

  if (url.pathname === '/setup') {
    const webhookUrl = url.searchParams.get('url');
    if (webhookUrl) {
      tgApi('setWebhook', { url: webhookUrl, max_connections: 40, allowed_updates: ['message'] }).then(r => {
        log('ok', `Webhook set: ${webhookUrl}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Provide ?url=https://your-app.com/webhook');
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('EON Quantum Cloud Bot v5.0');
});

process.on('uncaughtException', e => log('err', `uncaught: ${e.message}`));
process.on('unhandledRejection', e => log('err', `unhandled: ${e}`));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  log('ok', `EON Quantum Bot v5.0 listening on :${PORT}`);
  log('ok', `Webhook endpoint: /webhook`);
  log('ok', `Health: /health | Stats: /health`);
  log('ok', `6 quantum regions ready`);
});
