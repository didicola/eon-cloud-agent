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
const VERSION = '10.0-sovereign-autogenesis';

// Sovereign Auto-Genesis & Fluid Immune System — the Brain monitors itself.
import { heartbeatTick, handleApi, json } from './heartbeat.js';
// Pure Dark Matter — serverless Cloud IDE organ (KV + D1, zero earthly deps).
import { handleIde } from './cloud_ide.js';

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
// EON-REMOTE ORGAN — Sovereign Global Access
// Thin cloud relay: earthly fetches happen HERE from the Cloudflare edge,
// so earthly servers see only Cloudflare's IP and can never trace back
// to the EON origin. Cache + mirror bodies in KV when the binding exists,
// in-memory Map otherwise. No hardcoded hosts: /api/remote/discover
// self-reports whatever origin the caller used.
// ═══════════════════════════════════════════════════════════════════════

const REMOTE_VERSION = '1.0.0';
const REMOTE_BODY_TRUNCATE = 20000;      // bytes of body returned by /api/remote/fetch
const REMOTE_CACHE_CAP = 100000;         // bytes stored per cached fetch (KV-safe)
const REMOTE_MIRROR_CAP = 1000000;       // bytes stored per mirrored snapshot (KV-safe)
const REMOTE_INDEX_CAP = 500;            // max mirror records kept in the index

// In-memory fallback stores (used when env.EON_KV is not bound, or on KV failure)
const REMOTE_MEM_CACHE = new Map();      // url-hash -> {url,status,body,contentType,fetched_at}
const REMOTE_MEM_MIRRORS = new Map();    // ref -> {ref,url,fetched_at,size,status,contentType,body}
const REMOTE_MEM_INDEX = [];             // mirror records (metadata only in list)

// Stable djb2 hash -> KV-key-safe string (no long-URL key issues)
function remoteHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function remoteTruncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

// ── store abstraction: KV when bound, memory otherwise (both always kept warm) ──
function remoteMemGet(key) {
  if (key.startsWith('remote:cache:')) return REMOTE_MEM_CACHE.get(key.slice(13)) || null;
  if (key === 'remote:mirror:index') return REMOTE_MEM_INDEX.length ? [...REMOTE_MEM_INDEX] : null;
  if (key.startsWith('remote:mirror:')) return REMOTE_MEM_MIRRORS.get(key.slice(14)) || null;
  return null;
}
function remoteMemSet(key, val) {
  if (key.startsWith('remote:cache:')) REMOTE_MEM_CACHE.set(key.slice(13), val);
  else if (key === 'remote:mirror:index') { REMOTE_MEM_INDEX.length = 0; REMOTE_MEM_INDEX.push(...val); }
  else if (key.startsWith('remote:mirror:')) REMOTE_MEM_MIRRORS.set(key.slice(14), val);
}
async function remoteKvGet(kv, key) {
  if (!kv) return remoteMemGet(key);
  try {
    const v = (await kv.get(key, 'json')) ?? null;
    return v !== null ? v : remoteMemGet(key);
  } catch {
    return remoteMemGet(key);
  }
}
async function remoteKvPut(kv, key, val) {
  if (!kv) { remoteMemSet(key, val); return; }
  try {
    await kv.put(key, JSON.stringify(val));
  } catch (e) {
    console.log('EON-Remote: KV write failed, memory fallback — ' + (e && e.message ? e.message : e));
    remoteMemSet(key, val);
  }
}

async function remoteCacheGet(kv, hash) { return remoteKvGet(kv, 'remote:cache:' + hash); }
async function remoteCachePut(kv, hash, entry) { await remoteKvPut(kv, 'remote:cache:' + hash, entry); }
async function remoteMirrorGet(kv, ref) { return remoteKvGet(kv, 'remote:mirror:' + ref); }
async function remoteMirrorPut(kv, record) {
  await remoteKvPut(kv, 'remote:mirror:' + record.ref, record);
  const records = (await remoteKvGet(kv, 'remote:mirror:index')) || [];
  const i = records.findIndex(r => r.ref === record.ref);
  if (i >= 0) records[i] = record; else records.push(record);
  await remoteKvPut(kv, 'remote:mirror:index', records);
}

// SSRF guard: only public http(s) targets may be relayed. Private/link-local
// ranges, localhost and Cloudflare metadata endpoints are refused so the
// sovereign relay can never be used to reach internal networks.
function remoteIsSafeTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === 'metadata.google.internal' || host === 'instance-data') return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|7[0-9]|12[0-7])\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return false;
  return true;
}

function remoteJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

async function remoteDoFetch(rawUrl) {
  const r = await fetch(rawUrl, {
    headers: {
      'User-Agent': 'EON-Remote/1.0 (sovereign-edge relay)',
      'Accept': '*/*',
    },
    redirect: 'follow',
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  let body = '';
  try { body = new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
  catch { body = String.fromCharCode.apply(null, bytes.subarray(0, 4096)); }
  return { status: r.status, body, contentType: r.headers.get('content-type') || '' };
}

async function handleRemoteFetch(request, env, url) {
  const kv = env.EON_KV;
  const raw = url.searchParams.get('url') || '';
  if (!raw) return remoteJson({ ok: false, error: 'missing url param' }, 400);
  if (!remoteIsSafeTarget(raw)) return remoteJson({ ok: false, error: 'unsafe target' }, 400);

  const hash = remoteHash(raw);
  const cached = await remoteCacheGet(kv, hash);
  if (cached && cached.body) {
    return remoteJson({
      ok: true, status: cached.status, cached: true, from_cache: true,
      source: 'sovereign-edge', url: raw, fetched_at: cached.fetched_at,
      body: remoteTruncate(cached.body, REMOTE_BODY_TRUNCATE),
    });
  }

  try {
    const got = await remoteDoFetch(raw);
    const entry = {
      url: raw, status: got.status, body: got.body.slice(0, REMOTE_CACHE_CAP),
      contentType: got.contentType, fetched_at: Date.now(),
    };
    await remoteCachePut(kv, hash, entry);
    return remoteJson({
      ok: true, status: got.status, cached: false, from_cache: false,
      source: 'sovereign-edge', url: raw, fetched_at: entry.fetched_at,
      body: remoteTruncate(got.body, REMOTE_BODY_TRUNCATE),
    });
  } catch (e) {
    return remoteJson({ ok: false, error: 'fetch failed: ' + (e && e.message ? e.message : String(e)) }, 502);
  }
}

async function handleRemoteMirror(request, env, url) {
  const kv = env.EON_KV;
  const raw = url.searchParams.get('url') || '';
  let ref = url.searchParams.get('ref') || '';
  if (!raw) return remoteJson({ ok: false, error: 'missing url param' }, 400);
  if (!remoteIsSafeTarget(raw)) return remoteJson({ ok: false, error: 'unsafe target' }, 400);
  if (!ref) ref = 'mirror-' + Date.now().toString(36) + '-' + remoteHash(raw);
  if (!/^[A-Za-z0-9._-]+$/.test(ref)) return remoteJson({ ok: false, error: 'ref must match [A-Za-z0-9._-]' }, 400);

  try {
    const got = await remoteDoFetch(raw);
    const body = got.body.slice(0, REMOTE_MIRROR_CAP);
    const record = {
      ref, url: raw, fetched_at: Date.now(), size: body.length,
      status: got.status, contentType: got.contentType, body,
    };
    await remoteMirrorPut(kv, record);
    return remoteJson({
      ok: true, ref, url: raw, size: body.length, stored: true,
      fetched_at: record.fetched_at, status: got.status,
    });
  } catch (e) {
    return remoteJson({ ok: false, error: 'mirror failed: ' + (e && e.message ? e.message : String(e)) }, 502);
  }
}

async function handleRemoteList(request, env, url) {
  const kv = env.EON_KV;
  const records = (await remoteKvGet(kv, 'remote:mirror:index')) || [];
  const mirrors = records.map(({ body, ...meta }) => meta); // metadata only, no bodies
  return remoteJson({
    ok: true, count: mirrors.length, mirrors,
    storage: kv ? 'kv' : 'in-memory-map', timestamp: Date.now(),
  });
}

async function handleRemoteDiscover(request, env, url) {
  const kv = env.EON_KV;
  const index = (await remoteKvGet(kv, 'remote:mirror:index')) || [];
  const out = {
    ok: true,
    organ: 'eon-remote',
    version: REMOTE_VERSION,
    worker: VERSION,
    host: url.origin,                       // self-discovery — whatever origin the caller used
    storage: kv ? 'kv' : 'in-memory-map',
    mirrored: index.length,
    endpoints: [
      { path: '/api/remote/fetch', method: 'GET', params: ['url'], desc: 'sovereign fetch of an earthly URL (cached)' },
      { path: '/api/remote/mirror', method: 'GET', params: ['url', 'ref'], desc: 'snapshot an earthly resource under a named ref' },
      { path: '/api/remote/list', method: 'GET', params: [], desc: 'list mirrored resources' },
      { path: '/api/remote/discover', method: 'GET', params: [], desc: 'this self-discovery document' },
    ],
    timestamp: Date.now(),
  };
  if (!kv) out.cached_entries = REMOTE_MEM_CACHE.size;
  return remoteJson(out);
}

async function handleRemoteApi(request, env, url) {
  const path = url.pathname;
  if (path === '/api/remote/fetch' && request.method === 'GET') return handleRemoteFetch(request, env, url);
  if (path === '/api/remote/mirror' && request.method === 'GET') return handleRemoteMirror(request, env, url);
  if (path === '/api/remote/list' && request.method === 'GET') return handleRemoteList(request, env, url);
  if (path === '/api/remote/discover' && request.method === 'GET') return handleRemoteDiscover(request, env, url);
  return remoteJson({ ok: false, error: 'unknown remote route: ' + path }, 404);
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

    // ═══ SERVERLESS CLOUD IDE (Pure Dark Matter) — /ide + /api/ide/* ═══
    if (url.pathname === '/ide' || url.pathname.startsWith('/ide/') || url.pathname.startsWith('/api/ide/')) {
      return handleIde(request, url, kv, env.EON_D1, env);
    }

    // ═══ SOVEREIGN API — heartbeat / auto-genesis / fluid mesh / state sync ═══
    // (/api/remote/* is matched first below; everything else under /api routes
    // to the Sovereign Heartbeat + Infinite Memory State Sync handlers.)
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/remote/')) {
      return handleApi(request, url, kv, env);
    }

    // ═══ EON-REMOTE ORGAN (sovereign global access) ═══
    if (url.pathname.startsWith('/api/remote/')) {
      return handleRemoteApi(request, env, url);
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

  // Cron Trigger — polls Telegram + runs the Sovereign Heartbeat every minute
  async scheduled(event, env) {
    const kv = env.EON_KV;
    await Promise.all([
      pollUpdates(kv),
      heartbeatTick(kv, env).then(async ({ action }) => {
        // Auto-Genesis events are surfaced to the operator over Telegram.
        if (action && action !== 'none') {
          const label = String(action).startsWith('trigger')
            ? '🧬 *AUTO-GENESIS TRIGGERED* — local mesh bridge is offline. Spawned an ephemeral cloud VM to take over hosting until reconnection.'
            : '✅ *MESH RESTORED* — local bridge is back online. Ephemeral cloud VM commanded to cede control.';
          await tgApi('sendMessage', { chat_id: CHAT_ID, text: label, parse_mode: 'Markdown' }).catch(() => {});
        }
      }),
    ]);
  },
};
