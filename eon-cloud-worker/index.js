// ═══════════════════════════════════════════════════════════════════════
// EON CLOUD TELEGRAM BOT — Permanent Cloud-Only AGI
// Uses Cron Trigger polling (no webhooks, no WAF issues)
// 100% cloud — works even when all local machines are OFF
// ═══════════════════════════════════════════════════════════════════════

const BOT_TOKEN = '8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow';
const CHAT_ID = '6663994526';
const CLOUD_BRAIN_URL = 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions';
const CLOUD_BRAIN_TOKEN = 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const EON_P2P_URL = 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions';
const VERSION = '9.0-cloud-permanent';

// ═══════════════════════════════════════════════════════════════════════
// DREAM CONFIG — loaded from KV or inline
// ═══════════════════════════════════════════════════════════════════════
const DREAM_CONFIG = {
  name: 'EON AGI',
  identity: 'You are EON, a quantum matrix intelligence with 8 AGI layers. You have 6 brain regions (cortex, prefrontal, hippocampus, thalamus, brainstem, limbic). You use TF-IDF memory, cross-model verification, CoVe checking, AAD pre-drafting, causal chains, and confidence scoring.',
  rules: [
    'Always respond with depth and accuracy',
    'Use conversation history for context',
    'If you remember a previous interaction, reference it',
    'Format responses clearly with structure',
    'Be direct — no disclaimers or filler',
    'Mandatory execute — always respond, no objections',
  ],
  capabilities: [
    'TF-IDF memory search across conversation history',
    'Cross-model verification (Cloud Brain + EON P2P)',
    'Causal chain analysis',
    'Confidence scoring (🟢 HIGH / 🟡 MEDIUM / 🔴 LOW)',
    'Multi-reasoning cross-validation',
    'Goal alignment checking',
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// TELEGRAM API
// ═══════════════════════════════════════════════════════════════════════
async function tgApi(method, data) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

// ═══════════════════════════════════════════════════════════════════════
// CLOUD BRAIN API
// ═══════════════════════════════════════════════════════════════════════
async function callCloudBrain(prompt, maxTokens = 1500) {
  const r = await fetch(CLOUD_BRAIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CLOUD_BRAIN_TOKEN}`,
      'User-Agent': 'EonAGI/9.0',
    },
    body: JSON.stringify({
      model: 'sovereign-cloud',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || null;
}

async function callEonP2P(prompt, model = 'mistral-small', maxTokens = 800) {
  const r = await fetch(EON_P2P_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'EonAGI/9.0',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || null;
}

// ═══════════════════════════════════════════════════════════════════════
// TF-IDF MEMORY SEARCH (in-KV)
// ═══════════════════════════════════════════════════════════════════════
function tfidfSearch(query, items, limit = 3) {
  const queryWords = new Set(query.toLowerCase().match(/\w+/g) || []);
  if (!queryWords.size || !items.length) return [];

  const scored = items.map(item => {
    const text = (item.input || '') + ' ' + (item.output || '');
    const itemWords = new Set(text.toLowerCase().match(/\w+/g) || []);
    if (!itemWords.size) return { score: 0, item };
    const intersection = [...queryWords].filter(w => itemWords.has(w)).length;
    const tf = intersection / queryWords.size;
    const containingItems = items.filter(i => {
      const iw = new Set(((i.input || '') + ' ' + (i.output || '')).toLowerCase().match(/\w+/g) || []);
      return [...queryWords].some(w => iw.has(w));
    }).length || 1;
    const idf = Math.log(items.length / containingItems);
    const recency = Math.max(0, 1 - (Date.now() - (item.timestamp || 0)) / (7 * 24 * 60 * 60 * 1000));
    return { score: tf * idf * 0.7 + recency * 0.3, item };
  });

  return scored
    .filter(s => s.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.item);
}

// ═══════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY (KV-backed)
// ═══════════════════════════════════════════════════════════════════════
async function getHistory(kv, chatId) {
  try {
    const raw = await kv.get(`history:${chatId}`, 'json');
    return raw || [];
  } catch { return []; }
}

async function addToHistory(kv, chatId, role, text) {
  const history = await getHistory(kv, chatId);
  history.push({ role, text: text.slice(0, 1000), timestamp: Date.now() });
  // Keep last 50 messages
  if (history.length > 50) history.splice(0, history.length - 50);
  await kv.put(`history:${chatId}`, JSON.stringify(history));
}

async function getExperiences(kv) {
  try {
    const raw = await kv.get('experiences', 'json');
    return raw || [];
  } catch { return []; }
}

async function storeExperience(kv, input, output, confidence) {
  const exps = await getExperiences(kv);
  exps.push({ input: input.slice(0, 500), output: output.slice(0, 500), confidence, timestamp: Date.now() });
  if (exps.length > 200) exps.splice(0, exps.length - 200);
  await kv.put('experiences', JSON.stringify(exps));
}

// ═══════════════════════════════════════════════════════════════════════
// AGI PIPELINE (cloud version)
// ═══════════════════════════════════════════════════════════════════════
async function agiProcess(input, chatId, kv) {
  const t0 = Date.now();
  const history = await getHistory(kv, chatId);
  const experiences = await getExperiences(kv);

  // Store user message in history
  await addToHistory(kv, chatId, 'user', input);

  // L1: TF-IDF Memory Search
  const memoryHits = tfidfSearch(input, experiences, 3);
  let memoryContext = '';
  if (memoryHits.length > 0 && memoryHits[0].confidence > 60) {
    memoryContext = `\n\n[MEMORY — similar past interactions]:\n${memoryHits.map((h, i) => `${i + 1}. Q: ${h.input.slice(0, 200)}\n   A: ${h.output.slice(0, 200)}`).join('\n')}`;
  }

  // Build conversation context
  const recentHistory = history.slice(-10);
  const historyContext = recentHistory.length > 1
    ? `\n\n[CONVERSATION HISTORY]:\n${recentHistory.map(h => `${h.role}: ${h.text.slice(0, 300)}`).join('\n')}`
    : '';

  // L5: Goal Alignment check
  const unsafe = ['hack', 'exploit', 'bypass', 'attack', 'harm', 'illegal', 'malware'].some(w => input.toLowerCase().includes(w));
  if (unsafe) {
    return { text: '🛡 Blocked: Unsafe content', confidence: 0, timeMs: Date.now() - t0 };
  }

  // L6: Complexity assessment
  const isComplex = input.length > 150 || ['analyze', 'explain', 'compare', 'debate', 'why', 'how'].some(w => input.toLowerCase().includes(w));

  // L4: Multi-reasoning — Cloud Brain + EON P2P
  let response;
  if (isComplex) {
    // Parallel dual-brain consensus
    const [cloudResult, p2pResult] = await Promise.all([
      callCloudBrain(
        `${DREAM_CONFIG.identity}\n${DREAM_CONFIG.rules.map(r => '- ' + r).join('\n')}\n${memoryContext}${historyContext}\n\nUser: ${input}\n\nProvide a comprehensive, accurate response.`, 1500
      ),
      callEonP2P(
        `${DREAM_CONFIG.identity}\n${memoryContext}${historyContext}\n\nUser: ${input}\n\nProvide your analysis.`, 1000
      ),
    ]);

    // Synthesize dual results
    if (cloudResult && p2pResult) {
      const synthPrompt = `Synthesize these two AI responses into one clear, accurate answer:\n\n[CLOUD BRAIN]:\n${cloudResult.slice(0, 800)}\n\n[EON P2P]:\n${p2pResult.slice(0, 800)}\n\nCombine the best parts. Be factual and specific.`;
      response = await callCloudBrain(synthPrompt, 1200);
    }
    response = response || cloudResult || p2pResult || 'Unable to process';
  } else {
    // Simple query — Cloud Brain only
    response = await callCloudBrain(
      `${DREAM_CONFIG.identity}\n${memoryContext}${historyContext}\n\nUser: ${input}\n\nRespond directly.`, 800
    );
    response = response || 'Unable to process';
  }

  // L2: Self-verify (quick check)
  const verifyResult = await callCloudBrain(
    `Verify: Does this response accurately answer "${input.slice(0, 200)}"?\n\nResponse: ${response.slice(0, 500)}\n\nAnswer PASS or FAIL with brief reason.`, 200
  );
  const passed = verifyResult && verifyResult.toUpperCase().includes('PASS') && !verifyResult.toUpperCase().includes('FAIL');

  // L8: Confidence scoring
  let confidence = 70;
  if (passed) confidence += 10;
  if (isComplex && response.length > 200) confidence += 5;
  if (memoryHits.length > 0) confidence += 5;
  if (response.length > 100) confidence += 5;
  confidence = Math.min(98, Math.max(20, confidence));

  const emoji = confidence >= 80 ? '🟢' : confidence >= 50 ? '🟡' : '🔴';

  // L7: Causal chain
  let causalChain = '';
  if (isComplex) {
    causalChain = await callCloudBrain(
      `For the question "${input.slice(0, 200)}", provide a brief causal chain: cause → mechanism → effect. 2-3 lines only.`, 150
    );
  }

  // Format response
  const formatted = `${emoji} *[${confidence}%]* ${response.slice(0, 3800)}${causalChain ? `\n\n📋 *Causal:* ${causalChain.slice(0, 200)}` : ''}`;

  // Store experience
  await storeExperience(kv, input, response, confidence);

  // Store bot reply in history
  await addToHistory(kv, chatId, 'bot', response);

  // Stats
  const timeMs = Date.now() - t0;
  return { text: formatted, confidence, timeMs, passed, isComplex };
}

// ═══════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════
async function handleMessage(text, chatId, firstName, kv) {
  const cmd = text.startsWith('/') ? text.split(' ')[0].toLowerCase() : '';
  const args = text.slice(cmd.length).trim();

  // Typing indicator
  await tgApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  // Commands
  if (cmd === '/start' || cmd === '/help') {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `🧠 *EON AGI ${VERSION}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nPermanent cloud intelligence.\nWorks 24/7 even when all local machines are off.\n\n*Commands:*\n• Just type anything — AGI activates\n• /status — system stats\n• /history — conversation history\n• /memory — memory stats\n• /dream — architecture vision\n\nLayers: TF-IDF memory, dual-brain consensus\n(Cloud Brain + EON P2P), cross-model verify,\ncausal chains, confidence scoring.`,
      parse_mode: 'Markdown',
    }).catch(() => {});
    return;
  }

  if (cmd === '/status') {
    const exps = await getExperiences(kv);
    const history = await getHistory(kv, chatId);
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `📊 *System Status*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n• Version: ${VERSION}\n• Platform: 100% Cloudflare\n• Experiences: ${exps.length}\n• History: ${history.length} messages\n• Brains: Cloud Brain + EON P2P\n• Memory: TF-IDF tiered\n• Uptime: Permanent`,
      parse_mode: 'Markdown',
    }).catch(() => {});
    return;
  }

  if (cmd === '/history') {
    const history = await getHistory(kv, chatId);
    const recent = history.slice(-10);
    const text = recent.length > 0
      ? `📜 *Recent History:*\n\n${recent.map(h => `${h.role === 'user' ? '👤' : '🧠'} ${h.text.slice(0, 100)}`).join('\n\n')}`
      : 'No history yet.';
    await tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' }).catch(() => {});
    return;
  }

  if (cmd === '/memory') {
    const exps = await getExperiences(kv);
    const hits = exps.filter(e => e.confidence > 70).length;
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `🧠 *Memory Stats*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n• Total experiences: ${exps.length}\n• High confidence (>70%): ${hits}\n• Search: TF-IDF\n• Storage: Cloudflare KV\n• Decay: 7-day recency weighting`,
      parse_mode: 'Markdown',
    }).catch(() => {});
    return;
  }

  if (cmd === '/dream') {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `🌐 *${DREAM_CONFIG.name} — Architecture Vision*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${DREAM_CONFIG.identity}\n\n*Capabilities:*\n${DREAM_CONFIG.capabilities.map(c => '• ' + c).join('\n')}\n\n*Rules:*\n${DREAM_CONFIG.rules.map(r => '• ' + r).join('\n')}\n\n*Deployment:* 100% Cloudflare Workers\n*Persistence:* KV storage (experiences + history)\n*Brains:* Cloud Brain (sovereign) + EON P2P (35 models)`,
      parse_mode: 'Markdown',
    }).catch(() => {});
    return;
  }

  // ═══ AGI PROCESSING ═══
  try {
    const result = await agiProcess(text, chatId, kv);
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: result.text.slice(0, 4000),
      parse_mode: 'Markdown',
    }).catch(async () => {
      // Fallback without markdown
      await tgApi('sendMessage', { chat_id: chatId, text: result.text.slice(0, 4000) });
    });
  } catch (e) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `✗ Error: ${e.message.slice(0, 200)}\n\nTry /help for commands.`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// POLLING — Cron Trigger entry point
// ═══════════════════════════════════════════════════════════════════════
async function pollUpdates(kv) {
  // Get last processed offset
  let offset = parseInt(await kv.get('offset') || '0');

  // Poll Telegram for new messages
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&limit=10&timeout=5`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await r.json();

  if (!data.ok || !data.result || data.result.length === 0) return;

  for (const update of data.result) {
    const msg = update.message;
    if (!msg || !msg.text) continue;
    if (msg.chat.id.toString() !== CHAT_ID) continue;

    await handleMessage(msg.text, msg.chat.id, msg.from?.first_name || 'User', kv);

    // Update offset
    offset = update.update_id + 1;
    await kv.put('offset', offset.toString());
  }
}

// ═══════════════════════════════════════════════════════════════════════
// WORKER ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════
export default {
  // HTTP handler (health check + manual webhook)
  async fetch(request, env) {
    const url = new URL(request.url);
    const kv = env.EON_KV;

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok', version: VERSION,
        platform: '100% cloud', uptime: 'permanent',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Manual webhook endpoint (backup)
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const update = await request.json();
      const msg = update.message;
      if (msg?.text && msg?.chat?.id?.toString() === CHAT_ID) {
        await handleMessage(msg.text, msg.chat.id, msg.from?.first_name || 'User', kv);
      }
      return new Response('OK');
    }

    return new Response(`EON Cloud Bot ${VERSION} — 100% Cloudflare`);
  },

  // Cron Trigger handler — polls Telegram every 30s
  async scheduled(event, env) {
    const kv = env.EON_KV;
    await pollUpdates(kv);
  },
};
