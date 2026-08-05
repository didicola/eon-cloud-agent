// blind-proxy-lib.js — regenerated EON routing/budget/stream library
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const https = require('https');
const http = require('http');

// ─── Budget defaults per provider (token budget for compression) ───
const BUDGET_DEFAULTS = {
  or: 45000, tfg: 30000, fugu: 40000, mistral: 45000, gemini: 50000,
  hf: 40000, cerebras: 35000, sambanova: 40000, bazaarlink: 30000,
  groq: 45000, github: 40000, nvidia: 45000, cloudflare: 40000,
  ovh: 40000, freetheai: 40000, bynara: 30000, openmodel: 45000,
  freebuff: 35000, copilot: 50000, aiGateway: 45000, deepinfra: 45000,
  siliconflow: 45000, free: 40000, puterai: 40000
};

function budgetForProvider(provider) {
  return BUDGET_DEFAULTS[provider] || 40000;
}

// ─── Semantic cache (in-memory, LRU-ish) ───
const semanticCache = new Map();
const SEMANTIC_CACHE_MAX = 2000;

function _cacheKey(messages, model) {
  try {
    const last = messages[messages.length - 1];
    return model + '|' + (last?.content || JSON.stringify(messages)).slice(0, 400);
  } catch (e) { return model; }
}

function checkSemanticCache(messages, model) {
  const k = _cacheKey(messages, model);
  const hit = semanticCache.get(k);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (hit) semanticCache.delete(k);
  return null;
}

function setSemanticCache(messages, model, value) {
  const k = _cacheKey(messages, model);
  semanticCache.set(k, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
  if (semanticCache.size > SEMANTIC_CACHE_MAX) {
    const first = semanticCache.keys().next().value;
    semanticCache.delete(first);
  }
}

// ─── Message utilities ───
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(m => {
    const out = { role: m.role || 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '') };
    if (m.tool_calls && Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    return out;
  });
}

function compressMessages(messages, budgetTokens) {
  const budget = budgetTokens || 40000;
  const list = sanitizeMessages(messages);
  let total = 0;
  const kept = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const chars = (list[i].content || '').length;
    const est = Math.ceil(chars / 4);
    if (total + est > budget && kept.length > 0) break;
    total += est;
    kept.unshift(list[i]);
  }
  if (kept.length === 0 && list.length > 0) kept.push(list[list.length - 1]);
  return { messages: kept, dropped: list.length - kept.length, estimatedTokens: total };
}

// ─── Tool filtering ───
function scoreToolRelevance(tool, messages) {
  const last = messages[messages.length - 1]?.content || '';
  const desc = (tool.function?.description || '') + ' ' + (tool.function?.name || '');
  const q = (last + ' ' + (messages[messages.length - 2]?.content || '')).toLowerCase();
  let score = 0;
  const words = desc.toLowerCase().split(/\s+/);
  for (const w of words) { if (w.length > 4 && q.includes(w)) score += 2; }
  if (desc.toLowerCase().includes('web') && /web|url|http|site|browse/.test(q)) score += 3;
  if (desc.toLowerCase().includes('search') && /search|find|lookup/.test(q)) score += 3;
  if (desc.toLowerCase().includes('code') && /code|script|function|debug/.test(q)) score += 2;
  if (desc.toLowerCase().includes('image') && /image|photo|picture|draw/.test(q)) score += 3;
  if (desc.toLowerCase().includes('math') && /calc|math|compute|equation/.test(q)) score += 3;
  return score;
}

function filterRelevantTools(tools, messages, budgetTokens) {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  if (tools.length <= 4) return tools;
  const scored = tools.map(t => ({ t, s: scoreToolRelevance(t, messages || []) }));
  scored.sort((a, b) => b.s - a.s);
  const top = scored.filter(x => x.s > 0).map(x => x.t);
  const fallback = scored.slice(0, 4).map(x => x.t);
  const result = top.length >= 2 ? top.slice(0, 8) : fallback;
  return result.length ? result : tools.slice(0, 4);
}

function selectBestTools(tools, messages) {
  return filterRelevantTools(tools, messages, 40000);
}

// ─── sendEmptyResponse ───
function sendEmptyResponse(res, wantsStream) {
  try {
    if (res.writableEnded || res._responseSent) return;
    res._responseSent = true;
    const model = 'auto';
    if (wantsStream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data: ' + JSON.stringify({ id: 'empty', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }) + '\n\n');
      res.write('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'empty', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
    }
    res.end && !res.writableEnded && wantsStream && res.end();
  } catch (e) {}
}

// ─── fetchJSON ───
function fetchJSON(url, payload, timeoutMs, apiKey) {
  return new Promise((resolve, reject) => {
    const timeout = timeoutMs || 30000;
    let mod = http;
    let hostname, port, path, protocol;
    try {
      const u = new URL(url);
      mod = u.protocol === 'https:' ? https : http;
      hostname = u.hostname; port = u.port || (u.protocol === 'https:' ? 443 : 80); path = u.pathname + u.search;
    } catch (e) { reject(e); return; }
    const body = JSON.stringify(payload || {});
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    const req = mod.request({ hostname, port, path, method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error('HTTP ' + res.statusCode + ': ' + data.substring(0, 200)));
          else resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', e => reject(e));
    req.write(body); req.end();
  });
}

// ─── Provider → model mapping helpers ───
// Each returns a provider-specific model id for the requested earthly model, or null.

function orModelFor(model) {
  if (!model || model === 'auto' || model === 'auto:free') return null;
  const m = String(model);
  if (/deepseek/i.test(m)) return 'deepseek/deepseek-chat-v3-0324:free';
  if (/qwen/i.test(m)) return 'qwen/qwen-2.5-72b-instruct:free';
  if (/llama|meta/i.test(m)) return 'meta-llama/llama-3.3-70b-instruct:free';
  if (/gemini/i.test(m)) return 'google/gemini-2.0-flash-exp:free';
  if (/mistral/i.test(m)) return 'mistralai/mistral-7b-instruct:free';
  if (/grok/i.test(m)) return 'x-ai/grok-4.1-fast:free';
  if (/glm|zhipu/i.test(m)) return 'zhipuai/glm-4-flash:free';
  return 'deepseek/deepseek-chat-v3-0324:free';
}

function deepinfraModelFor(model) {
  const m = String(model || '');
  if (/llama/i.test(m)) return 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  if (/qwen/i.test(m)) return 'Qwen/Qwen2.5-72B-Instruct';
  if (/deepseek/i.test(m)) return 'deepseek-ai/DeepSeek-V3';
  if (/mistral/i.test(m)) return 'mistralai/Mistral-7B-Instruct-v0.3';
  return null;
}

function siliconflowModelFor(model) {
  const m = String(model || '');
  if (/qwen/i.test(m)) return 'Qwen/Qwen2.5-72B-Instruct';
  if (/deepseek/i.test(m)) return 'deepseek-ai/DeepSeek-V3';
  if (/glm/i.test(m)) return 'zai-org/GLM-4-9B-Chat';
  if (/llama/i.test(m)) return 'meta-llama/Llama-3.3-70B-Instruct';
  return null;
}

function geminiModelFor(model) {
  const m = String(model || '');
  if (/flash-lite/i.test(m)) return 'gemini-2.0-flash-lite';
  if (/flash/i.test(m)) return 'gemini-2.0-flash';
  return /pro/i.test(m) ? 'gemini-2.0-pro' : 'gemini-2.0-flash';
}

function mistralModelFor(model) {
  const m = String(model || '');
  if (/tiny/i.test(m)) return 'ministral-3b-latest';
  if (/small/i.test(m)) return 'mistral-small-latest';
  if (/medium/i.test(m)) return 'mistral-medium-latest';
  if (/large|big/i.test(m)) return 'mistral-large-latest';
  return 'open-mistral-7b';
}

function hfModelFor(model) {
  const m = String(model || '');
  if (/llama/i.test(m)) return 'meta-llama/Llama-3.3-70B-Instruct';
  if (/qwen/i.test(m)) return 'Qwen/Qwen2.5-72B-Instruct';
  if (/mistral/i.test(m)) return 'mistralai/Mistral-7B-Instruct-v0.3';
  return 'meta-llama/Llama-3.3-70B-Instruct';
}

function freeModelFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('gemini') || m.includes('flash')) return 'gemini-2.0-flash';
  if (m.includes('llama')) return 'llama-3.3-70b';
  if (m.includes('qwen')) return 'qwen-2.5-72b';
  return null;
}

function tfgModelFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('grok')) return 'grok-2-1212';
  if (m.includes('llama')) return 'llama-3.1-8b-instant';
  if (m.includes('qwen')) return 'qwen2.5-72b';
  if (m.includes('deepseek')) return 'deepseek-v3';
  return null;
}

function fuguModelFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('grok')) return 'grok-3';
  if (m.includes('llama')) return 'llama-3.3-70b';
  if (m.includes('qwen')) return 'qwen-2.5-72b';
  return null;
}

function freebuffModelFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('deepseek')) return 'deepseek-v4-flash';
  if (m.includes('llama')) return 'llama-3.3-70b';
  if (m.includes('qwen')) return 'qwen-2.5-72b';
  return 'deepseek-v4-flash';
}

function puterAIModelFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('gpt')) return 'gpt-4o-mini';
  if (m.includes('claude')) return 'claude-3-5-sonnet';
  if (m.includes('llama')) return 'llama-3.1-70b';
  return 'gpt-4o-mini';
}

function openmodelModelFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('deepseek')) return 'deepseek-v3';
  if (m.includes('gpt')) return 'gpt-4o-mini';
  if (m.includes('llama')) return 'llama-3.3-70b';
  return null;
}

function freebuffDeepseekFor() { return 'deepseek-v4-flash'; }

// Key-bearing providers below return a model id or null; the proxy tries them with their own keys.
function cerebrasModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? 'llama-3.3-70b' : 'llama-3.3-70b'; }
function sambanovaModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? 'Meta-Llama-3.3-70B-Instruct' : 'Meta-Llama-3.3-70B-Instruct'; }
function bazaarlinkModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('gpt') ? 'gpt-4o' : 'gpt-4o-mini'; }
function groqModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? 'llama-3.3-70b-versatile' : (m.includes('qwen') ? 'qwen-2.5-32b' : 'llama-3.1-8b-instant'); }
function githubModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('gpt') ? 'gpt-4o-mini' : 'gpt-4o-mini'; }
function nvidiaModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? 'meta/llama-3.3-70b-instruct' : 'meta/llama-3.3-70b-instruct'; }
function cloudflareModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast' : '@cf/meta/llama-3.3-70b-instruct-fp8-fast'; }
function ovhModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? 'Meta-Llama-3.3-70B-Instruct' : 'Meta-Llama-3.3-70B-Instruct'; }
function freetheaiModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? 'llama-3.1-8b' : 'llama-3.1-8b'; }
function bynaraModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('deepseek') ? 'deepseek-v3' : 'deepseek-v3'; }
function copilotModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('gpt') ? 'gpt-4o' : 'gpt-4o'; }
function aiGatewayModelFor(model) { const m = String(model || '').toLowerCase(); return m.includes('llama') ? 'llama-3.1-8b' : 'llama-3.1-8b'; }

// ─── Task inference ───
function inferTaskType(messages) {
  const text = (messages.map(m => m?.content || '').join(' ') || '').toLowerCase();
  if (/write.*code|implement|build.*app|debug.*script|create.*api|function|class\b/.test(text)) return 'code';
  if (/math|calculate|compute|equation|sum\b/.test(text)) return 'math';
  if (/search|find|lookup|who is|what is|weather|news\b/.test(text)) return 'web';
  if (/translate|english|french|spanish/.test(text)) return 'translate';
  if (/summar|tl;dr|shorten/.test(text)) return 'summary';
  if (/analy.*data|csv|json|database|sql\b/.test(text)) return 'data';
  return 'chat';
}

// ─── Smart model selection ───
const MODEL_COST = {
  deepseek: 0.0001, gemini: 0.0002, qwen: 0.0003, llama: 0.0004, grok: 0.001, gpt: 0.002, claude: 0.003
};

function smartSelectModel(reqModel, messages) {
  const task = inferTaskType(messages || []);
  const text = (messages.map(m => m?.content || '').join(' ') || '').toLowerCase();
  let model = 'deepseek-chat-v3';
  if (task === 'code') model = 'deepseek-chat-v3';
  else if (task === 'web' || task === 'summary') model = 'gemini-2.0-flash';
  else if (task === 'data') model = 'qwen2.5-72b';
  else if (task === 'math') model = 'deepseek-chat-v3';
  else if (/grok|gpt|claude/i.test(text)) model = 'gpt-4o-mini';
  const baseCost = MODEL_COST[String(model).split('-')[0]] || 0.0005;
  return { provider: 'deepinfra', model, estimatedCost: baseCost, task };
}

// ─── Budget tracker ───
const budgetTracker = {
  _spends: [],
  recordSpend(model, tokens, cost) {
    this._spends.push({ model, tokens: tokens || 0, cost: cost || 0, ts: Date.now() });
    if (this._spends.length > 10000) this._spends.splice(0, 1000);
  }
};

function getBudgetStats() {
  const spends = budgetTracker._spends;
  const totalCost = spends.reduce((a, b) => a + (b.cost || 0), 0);
  const totalTokens = spends.reduce((a, b) => a + (b.tokens || 0), 0);
  const perModel = {};
  for (const s of spends) { perModel[s.model] = (perModel[s.model] || 0) + (s.cost || 0); }
  return {
    total_cost: totalCost.toFixed(6), total_tokens: totalTokens,
    requests: spends.length, per_model: perModel, window: 'since-restore'
  };
}

// ─── Circuit breaker (provider health) ───
const providerFailures = new Map(); // provider:model -> {count, lastFail, blockedUntil}
const CIRCUIT_WINDOW = 120000;

function recordProviderFailure(provider, model, status) {
  const k = provider + ':' + (model || '?');
  const rec = providerFailures.get(k) || { count: 0, lastFail: 0, blockedUntil: 0 };
  rec.count++; rec.lastFail = Date.now();
  const blockMs = status === 429 ? 300000 : 120000;
  rec.blockedUntil = Date.now() + blockMs;
  if (rec.count >= 3) rec.blockedUntil = Date.now() + blockMs;
  providerFailures.set(k, rec);
}

function recordProviderSuccess(provider, model) {
  const k = provider + ':' + (model || '?');
  const rec = providerFailures.get(k);
  if (rec) { rec.count = Math.max(0, rec.count - 1); if (rec.count === 0) providerFailures.delete(k); else providerFailures.set(k, rec); }
}

function isCircuitBreakerOpen(provider, model) {
  const rec = providerFailures.get(provider + ':' + (model || '?'));
  return rec ? (Date.now() < rec.blockedUntil) : false;
}

function getCircuitBreakerDelay(provider, model) {
  const rec = providerFailures.get(provider + ':' + (model || '?'));
  return rec ? Math.max(0, rec.blockedUntil - Date.now()) : 0;
}

// ─── Routing result learning ───
const routingScores = new Map(); // provider:model -> {ok, fail, msSum, n}

function recordRoutingResult(provider, model, ok, ms, task) {
  const k = provider + ':' + (model || '?');
  const rec = routingScores.get(k) || { ok: 0, fail: 0, msSum: 0, n: 0 };
  if (ok) rec.ok++; else rec.fail++;
  rec.msSum += ms || 0; rec.n++;
  routingScores.set(k, rec);
}

function learnedProviderScore(provider, model) {
  const rec = routingScores.get(provider + ':' + (model || '?'));
  if (!rec || rec.n === 0) return 0.5;
  return rec.ok / rec.n;
}

// ─── Stream watcher ───
function createStreamWatcher(upReq, res, timeoutMs) {
  let started = false;
  let aborted = false;
  let bytes = 0;
  let resolveFn = null;
  let extra = null;
  const timeout = timeoutMs || 60000;
  let timer = setTimeout(() => { aborted = true; try { upReq.destroy(); } catch (e) {} if (resolveFn) resolveFn({ ok: false, error: 'timeout', started, aborted }); }, timeout + 5000);
  timer.unref && timer.unref();
  return {
    bind(fn, opts) { resolveFn = fn; extra = opts || null; },
    onData(chunk) { if (!started) started = true; bytes += chunk.length; },
    onEnd() {
      clearTimeout(timer);
      return { started, aborted, bytes, extra };
    },
    cancel() { clearTimeout(timer); }
  };
}

// ─── Stream watchdog (timeout safety) ───
function createStreamWatchdog(wantsStream, res) {
  let responded = false;
  let timer = setTimeout(() => {
    if (!responded && !res.writableEnded) {
      try {
        res.end();
        res._responseSent = true;
      } catch (e) {}
    }
  }, 30000);
  timer.unref && timer.unref();
  return {
    markResponded() { responded = true; clearTimeout(timer); },
    cancel() { clearTimeout(timer); }
  };
}

module.exports = {
  scoreToolRelevance, filterRelevantTools, sendEmptyResponse, fetchJSON,
  orModelFor, tfgModelFor, fuguModelFor, mistralModelFor, geminiModelFor,
  hfModelFor, cerebrasModelFor, sambanovaModelFor, bazaarlinkModelFor,
  groqModelFor, githubModelFor, nvidiaModelFor, cloudflareModelFor,
  ovhModelFor, freetheaiModelFor, bynaraModelFor, openmodelModelFor,
  freebuffModelFor, copilotModelFor, aiGatewayModelFor, deepinfraModelFor,
  siliconflowModelFor, freeModelFor, puterAIModelFor, freebuffDeepseekFor,
  sanitizeMessages, compressMessages, budgetForProvider, selectBestTools,
  BUDGET_DEFAULTS, smartSelectModel, inferTaskType, budgetTracker,
  getBudgetStats, createStreamWatcher, recordProviderFailure,
  getCircuitBreakerDelay, isCircuitBreakerOpen, recordProviderSuccess,
  checkSemanticCache, setSemanticCache, createStreamWatchdog,
  recordRoutingResult, learnedProviderScore
};
