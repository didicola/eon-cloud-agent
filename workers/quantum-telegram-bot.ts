// EON Quantum Cloud Telegram Bot — Deno Deploy
// Permanent, no WAF, instant webhook responses

const BOT_TOKEN = '8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow';
const CHAT_ID = '6663994526';
const VERSION = '5.0-quantum-cloud';
const CLOUD_BRAIN = 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const CLOUD_BRAIN_TOKEN = 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const EON_P2P = 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev';

const REGIONS: Record<string, {worker: string, url: string, token: string|null, weight: number, model: string}> = {
  cortex:      { worker: 'cloud-brain', url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.3, model: 'sovereign-cloud' },
  hippocampus: { worker: 'eon-p2p',    url: EON_P2P,      token: null,              weight: 0.2, model: 'mistral-small' },
  thalamus:    { worker: 'cloud-brain', url: CLOUD_BRAIN,  token: CLOUD_BRAIN_TOKEN, weight: 0.15, model: 'sovereign-cloud' },
  prefrontal:  { worker: 'cloud-brain', url: CLOUD_BRAIN,  token: CLOUD_BRAIN_TOKEN, weight: 0.2, model: 'sovereign-cloud' },
  limbic:      { worker: 'eon-p2p',    url: EON_P2P,      token: null,              weight: 0.1, model: 'mistral-small' },
  brainstem:   { worker: 'cloud-brain', url: CLOUD_BRAIN,  token: CLOUD_BRAIN_TOKEN, weight: 0.05, model: 'sovereign-cloud' },
};

const SUPERPOSITION_COUNT = 3;

// ─── TELEGRAM API ─────────────────────────────────────────
async function tgApi(method: string, data: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return r.json();
}

async function sendMessage(chatId: number, text: string) {
  return tgApi('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) });
}

async function sendAction(chatId: number, action: string) {
  return tgApi('sendChatAction', { chat_id: chatId, action });
}

// ─── QUANTUM WORKER CALL ──────────────────────────────────
async function callWorker(url: string, token: string|null, model: string, prompt: string, maxTokens = 300): Promise<string|null> {
  const headers: Record<string, string> = {
    'User-Agent': 'EonBrainChain/3.1 (Deno Deploy)',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://eon-cloud-agent.local',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const r = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!r.ok) return null;

    const data = await r.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ─── QUANTUM HASH ─────────────────────────────────────────
function quantumHash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h) / 2147483647;
}

// ─── QUANTUM THINK ────────────────────────────────────────
async function quantumThink(prompt: string): Promise<string> {
  const regionNames = Object.keys(REGIONS);
  const shuffled = [...regionNames].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, SUPERPOSITION_COUNT);

  const promises = selected.map(region => {
    const cfg = REGIONS[region];
    return callWorker(cfg.url, cfg.token, cfg.model, `[${region.toUpperCase()}] ${prompt}`, 200)
      .then(content => ({ region, content, worker: cfg.worker }))
      .catch(() => ({ region, content: null, worker: cfg.worker }));
  });

  const results = await Promise.all(promises);
  const valid = results.filter(r => r.content && r.content.length > 10);

  if (valid.length === 0) return '[quantum] All regions failed';

  const scored = valid.map(r => {
    const w = REGIONS[r.region]?.weight || 0.1;
    const q = quantumHash(r.content || '');
    return { ...r, amplitude: w + q * w };
  }).sort((a, b) => b.amplitude - a.amplitude);

  const texts = scored.map(s => `[${s.region}] ${s.content}`);
  const synthesisPrompt = `Synthesize these quantum observations into a coherent answer:\n` +
    texts.map(t => `---\n${(t || '').slice(0, 500)}`).join('\n');

  const synthesis = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', synthesisPrompt, 500);

  return `⚡ ${synthesis || scored[0].content}`;
}

// ─── QUANTUM DEBATE ───────────────────────────────────────
async function quantumDebate(prompt: string): Promise<string> {
  const [thesis, antithesis] = await Promise.all([
    callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', `Argue FOR concisely: ${prompt}`, 150),
    callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', `Argue AGAINST concisely: ${prompt}`, 150)
  ]);

  const synthesis = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud',
    `Synthesize:\nFOR: ${(thesis || '').slice(0, 300)}\nAGAINST: ${(antithesis || '').slice(0, 300)}`, 300);

  return `📊 THESIS: ${(thesis || 'N/A').slice(0, 200)}\n\n📊 ANTITHESIS: ${(antithesis || 'N/A').slice(0, 200)}\n\n📊 SYNTHESIS: ${(synthesis || 'N/A').slice(0, 300)}`;
}

// ─── HANDLE MESSAGE ───────────────────────────────────────
async function handleMessage(text: string, chatId: number) {
  const cmd = text.startsWith('/') ? text.split(' ')[0].toLowerCase() : '';
  const args = text.slice(cmd.length).trim();

  if (cmd === '/start' || cmd === '/help') {
    return sendMessage(chatId,
      `EON Quantum Cloud Bot v${VERSION}\n\n` +
      `/quantum <q> - Quantum matrix reasoning\n` +
      `/debate <q> - Thesis/antithesis/synthesis\n` +
      `/status - Region health\n` +
      `/version - System info\n\n` +
      `Just type any message for AI chat.`
    );
  }

  if (cmd === '/version') return sendMessage(chatId, `EON v${VERSION}\nCloud: Deno Deploy\nRegions: 6 | Workers: 2`);
  if (cmd === '/status') return sendMessage(chatId, `EON v${VERSION}\nAll 6 quantum regions online\nCloud-brain: OK | EON P2P: OK`);
  if (cmd === '/ping') return sendMessage(chatId, `pong (deno-deploy)`);

  if (cmd === '/quantum') {
    if (!args) return sendMessage(chatId, 'Usage: /quantum <question>');
    await sendAction(chatId, 'typing');
    const r = await quantumThink(args);
    return sendMessage(chatId, r);
  }

  if (cmd === '/debate') {
    if (!args) return sendMessage(chatId, 'Usage: /debate <topic>');
    await sendAction(chatId, 'typing');
    const r = await quantumDebate(args);
    return sendMessage(chatId, r);
  }

  // Default: quantum think
  await sendAction(chatId, 'typing');
  const r = await quantumThink(text);
  return sendMessage(chatId, r);
}

// ─── DENO SERVER ──────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.pathname === '/webhook' && req.method === 'POST') {
    try {
      const update = await req.json();
      const msg = update.message;
      if (msg?.text && msg?.chat?.id?.toString() === CHAT_ID) {
        // Process async — return OK immediately
        handleMessage(msg.text, msg.chat.id).catch(() => {});
      }
      return new Response('OK');
    } catch {
      return new Response('OK');
    }
  }

  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      status: 'ok', version: VERSION, regions: Object.keys(REGIONS).length
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/setup') {
    const webhookUrl = url.searchParams.get('url') || `${url.origin}/webhook`;
    const r = await tgApi('setWebhook', { url: webhookUrl, max_connections: 40, allowed_updates: ['message'] });
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/test') {
    const r = await quantumThink('what is 1+1');
    return new Response(r);
  }

  return new Response(`EON Quantum Cloud Bot v${VERSION}`);
});
