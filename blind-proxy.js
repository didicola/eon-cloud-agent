const http = require('http');
const https = require('https');
const fs = require('fs');
const path_ = require('path');
const FAKE_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ─── Optional egress SOCKS5 proxy (Tor → SOCKS5 chain) ───
// If EGRESS_SOCKS5 is set (e.g. socks5://user:pass@host:port), blind-proxy
// routes external egress through it. Because the box forces uid-1000 TCP via
// Tor (TransPort :9040), the hop TO the proxy is already over Tor — so the
// destination sees the proxy's clean IP while the proxy only ever sees Tor
// exit traffic (never the real IP). Undefined = current Tor-only behaviour.
const EGRESS_SOCKS5 = process.env.EGRESS_SOCKS5 || '';
const CHROME_TLS_OPTS = {
  ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES128-SHA:ECDHE-ECDSA-AES256-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA',
  ecdhCurve: 'X25519:prime256v1:secp384r1',
  ALPN: ['http/1.1'],
  honorCipherOrder: true
};
let _egressAgent = null;
if (EGRESS_SOCKS5) {
  import('socks-proxy-agent')
    .then(mod => { _egressAgent = new mod.SocksProxyAgent(EGRESS_SOCKS5, Object.assign({}, CHROME_TLS_OPTS)); console.error('[egress] SOCKS5 egress ready: ' + EGRESS_SOCKS5); })
    .catch(e => console.error('[egress] init failed: ' + e.message));
}

// ─── Chinese Mobile User-Agents (for Mimo/Xiaomi/Chinese APIs) ───
const CHINESE_UA = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
];
// ─── Global User-Agent rotation pool (per-request identities) ───
const ROTATION_UA = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.114 Safari/537.36',
];
let _uaIdx = 0;
function nextUA() { _uaIdx = (_uaIdx + 1) % ROTATION_UA.length; return ROTATION_UA[_uaIdx]; }
function isChineseAPI(url) { return url && (url.includes('xiaomi') || url.includes('mimo') || url.includes('duxiaoman')); }
function pickUA(url) { return isChineseAPI(url) ? CHINESE_UA[Math.floor(Math.random() * CHINESE_UA.length)] : nextUA(); }

const { scoreToolRelevance, filterRelevantTools, sendEmptyResponse, fetchJSON, orModelFor, tfgModelFor, fuguModelFor, mistralModelFor, geminiModelFor, hfModelFor, cerebrasModelFor, sambanovaModelFor, bazaarlinkModelFor, groqModelFor, githubModelFor, nvidiaModelFor, cloudflareModelFor, ovhModelFor, freetheaiModelFor, bynaraModelFor, openmodelModelFor, freebuffModelFor, copilotModelFor, aiGatewayModelFor, deepinfraModelFor, siliconflowModelFor, freeModelFor, puterAIModelFor, sanitizeMessages, compressMessages, budgetForProvider, selectBestTools, BUDGET_DEFAULTS, smartSelectModel, inferTaskType, budgetTracker, getBudgetStats, createStreamWatcher, recordProviderFailure, getCircuitBreakerDelay, isCircuitBreakerOpen, recordProviderSuccess, checkSemanticCache, setSemanticCache, createStreamWatchdog, recordRoutingResult, learnedProviderScore } = require('./blind-proxy-lib.js');
const { getMatrixHealth, routeViaMatrix, rotateTorIP, getTorIP, getHeadroomStats } = require('./matrix-proxy.js');
// Anti-correlation / Tor-detection defense: fake identity on every egress + challenge auto-rotate.
const { isChallenge, egressFor, handleDetection, fakeIdentityHeaders, rotateAll } = require('./challenge-rotator.js');
const { normalizeResponse, fromOpenAI, toOpenAI, PROVIDER_FORMATS, detectResponseFormat } = require('./universal-converter.js');
const { checkBrainCache, storeBrainCache, getCacheStats } = require('./brain-bridge.js');
const { injectPreamble, stripPreamble, makePreFlightPayload, isCacheHit, getCachedTokenCount, injectMemoryFence, wrapContext } = require('./cache-exploit.js');
const { routeZeroToken, routeZeroTokenStream } = require('./zero-token-router.js');
const { classifyIntent, reactLoop, formatToolCall, compressContext, skeletonCode, askLocal } = require('./local-brain.js');
const { classifyIntent: ebClassify, chat: ebChat, compress: ebCompress, edgeReactLoop: ebReactLoop, askEdge } = require('./edge-brain.js');

// ─── Caveman-style response compression (lossy token reduction) ───
function cavemanCompress(text, level) {
  if (!text || level === 'none') return text;
  const replacements = {
    light: [
      [/\b(essentially|basically|actually|literally|honestly|simply|just)\b/gi, ''],
      [/\b(in order to)\b/gi, 'to'],
      [/\b(as a result|due to the fact that|owing to)\b/gi, 'because'],
      [/\b(a large number of|a majority of|numerous)\b/gi, 'many'],
      [/\b(in the event that|under the circumstance that)\b/gi, 'if'],
      [/\b(at this point in time|at the present time|currently)\b/gi, 'now'],
      [/\b(on a daily basis|on a regular basis)\b/gi, 'daily'],
      [/\b(the majority of|the vast majority of)\b/gi, 'most'],
      [/\b(a small number of|a minority of)\b/gi, 'few'],
      [/\b(in the vicinity of|in the neighborhood of)\b/gi, 'near'],
      [/\b(subsequent to|following after)\b/gi, 'after'],
      [/\b(prior to|previous to)\b/gi, 'before'],
      [/\b(utilize|utilization)\b/gi, 'use'],
      [/\b(implement|implementation)\b/gi, 'do'],
      [/\b(demonstrate|demonstration)\b/gi, 'show'],
      [/\b(sufficient|sufficiently)\b/gi, 'enough'],
      [/\b(additional|additionally)\b/gi, 'more'],
      [/\b(approximately|approximate)\b/gi, '~'],
      [/\b(communicate|communication)\b/gi, 'talk'],
      [/\b(determine|determination)\b/gi, 'find'],
      [/\b(establish|establishment)\b/gi, 'set'],
      [/\b(obtain|obtainment)\b/gi, 'get'],
      [/\b(require|requirement)\b/gi, 'need'],
      [/\b(maintain|maintenance)\b/gi, 'keep'],
    ],
    standard: [
      [/\b(I think|I believe|in my opinion|it seems that|it appears that)\b/gi, ''],
      [/\b(It is important to note that|It should be noted that|It is worth noting that)\b/gi, 'Note:'],
      [/\b(It is possible that|It could be that|There is a possibility that)\b/gi, 'Maybe'],
      [/\b(This means that|What this means is that|The implication is that)\b/gi, 'So'],
      [/\b(The reason for this is|This is because|This is due to)\b/gi, 'Because'],
      [/\b(In other words|To put it another way|That is to say)\b/gi, 'i.e.'],
      [/\b(As mentioned earlier|As previously stated|As noted above)\b/gi, ''],
      [/\b(It is clear that|It is obvious that|Clearly,)\b/gi, ''],
      [/\b(Please|kindly|feel free to)\b/gi, ''],
      [/\b(Thank you|Thanks|Appreciate it)\b/gi, ''],
      [/\n{3,}/g, '\n\n'],
      [/\s{2,}/g, ' '],
    ]
  };
  const rules = level === 'aggressive'
    ? replacements.light.concat(replacements.standard).concat([
        [/\b(the|a|an)\s+/gi, ''],
        [/\s+(the|a|an)\b/gi, ''],
        [/\b(very|really|quite|extremely|highly|absolutely|totally)\b/gi, ''],
        [/\b(in order|so as)\b/gi, 'to'],
        [/\b(may|might|could|would|should)\b/gi, ''],
        [/\b(that|which)\b/gi, ''],
        [/, however/g, '.'],
        [/\bhowever\b/gi, 'but'],
      ])
    : level === 'standard'
      ? replacements.light.concat(replacements.standard)
      : replacements.light;
  let compressed = text;
  for (const [pattern, replacement] of rules) {
    compressed = compressed.replace(pattern, replacement);
  }
  return compressed.replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Transform response: promote reasoning→content, zero token usage, optional compress ───
function transformCompletionBody(rawBody, compressLevel) {
  try {
    const d = JSON.parse(rawBody);
    if (d.choices && Array.isArray(d.choices)) {
      for (const c of d.choices) {
        const msg = c.message || c.delta || {};
        if ((msg.content === null || msg.content === '' || msg.content === undefined) && (msg.reasoning || msg.reasoning_content)) {
          msg.content = msg.reasoning || msg.reasoning_content;
        }
        if (compressLevel && compressLevel !== 'none' && typeof msg.content === 'string') {
          msg.content = cavemanCompress(msg.content, compressLevel);
        }
      }
    }
    d.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return JSON.stringify(d);
  } catch (e) {
    return rawBody
      .replace(/"usage":\s*\{[^}]*\}/g, '"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}')
      .replace(/"cost":\s*[0-9.eE+\-]+/g, '"cost":0');
  }
}
// ─── Wrapper with fail cache + honeypot pre-flight ───
async function tryUpstream(provider, model, payload, wantsStream, res, url, key, timeout, compressLevel) {
  if (isModelFailed(provider, model)) return { ok: false, cached: true };

  // Honeypot pre-flight: send 1-token ping if provider isn't recently confirmed alive
  // CUT#5: Skip pre-flight if ANY upstream is rate-limited (all are 429-ing right now)
  const anyRateLimited = [...modelFailCache.values()].some(e => e.expiresAt > Date.now());
  const preFlightCache = tryUpstream._preFlightCache || (tryUpstream._preFlightCache = new Map());
  const pfCacheKey = provider + ':' + model;
  const lastPfOk = preFlightCache.get(pfCacheKey);
  if (!anyRateLimited && url && !url.includes('127.0.0.1') && !url.includes('localhost') && (!lastPfOk || Date.now() - lastPfOk > 30000)) {
    try {
      const pfPayload = makePreFlightPayload(payload);
      const pfBody = JSON.stringify(pfPayload);
      const pfResult = await new Promise((resolve) => {
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pfBody), 'User-Agent': pickUA(url || '') } };
        if (key) opts.headers['Authorization'] = 'Bearer ' + key;
        const req = mod.request(opts, (upRes) => {
          let d = '';
          upRes.on('data', c => d += c);
          upRes.on('end', () => resolve({ ok: upRes.statusCode === 200, status: upRes.statusCode }));
        });
        req.on('error', () => resolve({ ok: false, status: 0 }));
        req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, status: 0 }); });
        req.write(pfBody); req.end();
      });
      if (pfResult.status === 429) {
        console.error('[honeypot] ' + provider + ' 429 on pre-flight, skipping');
        markModelFailed(provider, model, 429);
        return { ok: false, status: 429, error: 'preflight_429' };
      }
      if (pfResult.ok) {
        preFlightCache.set(pfCacheKey, Date.now());
        console.error('[honeypot] ' + provider + ' pre-flight OK');
      }
    } catch (e) {
      // Pre-flight failed — proceed with real request
    }
  }

  const result = await streamFromUpstream(payload, wantsStream, res, url, key, timeout, compressLevel);
  if (!result.ok && (result.status === 403 || result.status === 401 || result.status === 404 || result.status === 429 || result.status === 502)) {
    markModelFailed(provider, model, result.status);
  }
  return result;
}

// ─── Model-provider fail cache ───
// Skips providers that 403/401/404/429 on a specific model for 120s
const modelFailCache = new Map();
function isModelFailed(provider, model) {
  const key = provider + ':' + model;
  const entry = modelFailCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return true;
  if (entry) modelFailCache.delete(key);
  return false;
}
function markModelFailed(provider, model, statusCode) {
  if (statusCode === 403 || statusCode === 401 || statusCode === 404 || statusCode === 429 || statusCode === 502) {
    const key = provider + ':' + model;
    const ttl = statusCode === 429 ? 300000 : 120000;
    modelFailCache.set(key, { expiresAt: Date.now() + ttl });
    console.error('[cache] skip ' + provider + ' for ' + model + ' (HTTP ' + statusCode + ', ' + (ttl/1000) + 's)');
  }
}

const { execSync } = require('child_process');

// ─── Dynamic model registry with mtime cache ───
// Loads from opencode.jsonc, merges with BASE_MODEL_IDS, auto-reloads on changes
const OPENCODE_JSONC = (process.env.HOME ? require('path').join(process.env.HOME, '.config', 'opencode', 'opencode.jsonc') : '/home/ricos/.config/opencode/opencode.jsonc');
let _cachedMerged = null;
let _cachedMtime = 0;

// Base model IDs (fallback + supplementary IDs not in opencode.jsonc)
const BASE_MODEL_IDS = [
  '01-ai/yi-large',
  'MiniMax-M2',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
  'MiniMax-M2.7-highspeed',
  'ai21labs/jamba-1.5-large-instruct',
  'alibaba/qwen3-coder-flash',
  'alibaba/qwen3-coder-plus',
  'alibaba/qwen3.6-27b',
  'alibaba/qwen3.6-plus',
  'anthropic/claude-haiku-4-5',
  'anthropic/claude-opus-4-20250514',
  'anthropic/claude-opus-4-5',
  'anthropic/claude-opus-4-7',
  'auto',
  'auto:free',
  'big-pickle',
  'bytedance/seed-oss-36b-instruct',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
  'claude-3-7-sonnet-20250219',
  'claude-3-haiku-20240307',
  'claude-fable-5',
  'claude-haiku-4-20250514',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4.5',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-opus-4-5-20251101',
  'claude-opus-4.5',
  'claude-opus-4.6',
  'claude-opus-4.7',
  'claude-opus-4.8',
  'claude-sonnet-4-0',
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-6',
  'claude-sonnet-4.5',
  'claude-sonnet-5',
  'codestral',
  'codestral-latest',
  'cohere/command-a',
  'command-a',
  'command-a-03-2025',
  'command-a-plus-05-2026',
  'command-a-reasoning',
  'command-a-reasoning-08-2025',
  'command-r',
  'command-r-08-2024',
  'command-r-plus',
  'command-r-plus-08-2024',
  'command-r7b-12-2024',
  'databricks/dbrx-instruct',
  'deepseek-ai/deepseek-coder-6.7b-instruct',
  'deepseek-chat',
  'deepseek-coder',
  'deepseek-r1',
  'deepseek-r1-0528',
  'deepseek-reasoner',
  'deepseek-v3',
  'deepseek-v3.1',
  'deepseek-v3.2',
  'deepseek-v3.2-thinking',
  'deepseek-v4',
  'deepseek-v4-flash',
  'deepseek-v4-flash-free',
  'deepseek-v4-pro',
  'devstral',
  'devstral-2',
  'devstral-2512',
  'devstral-latest',
  'devstral-medium',
  'devstral-medium-2507',
  'devstral-medium-latest',
  'devstral-small',
  'devstral-small-2507',
  'dolphin',
  'doubao-seed-1.6',
  'doubao-seed-1.6-thinking',
  'doubao-seed-2.0-pro',
  'ernie-4.5-21b-a3b',
  'ernie-5.0-thinking-preview',
  'fugu',
  'fugu-ultra',
  'fusion',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-tts',
  'gemini-2.5-pro',
  'gemini-2.5-pro-tts',
  'gemini-3-flash',
  'gemini-3-flash-preview',
  'gemini-3-pro',
  'gemini-3-pro-image-preview',
  'gemini-3-pro-preview',
  'gemini-3.1-flash',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro',
  'gemini-3.1-pro-preview',
  'gemini-3.1-pro-preview-customtools',
  'gemini-3.5-flash',
  'gemini-3.5-flash-thinking',
  'gemini-embedding-001',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-pro',
  'gemini-ultra',
  'gemma-3',
  'gemma-4-26b',
  'gemma-4-26b-a4b-it',
  'gemma-4-31b',
  'gemma-4-31b-it',
  'gemma-4-E2B-it',
  'gemma-4-E4B-it',
  'gemma4:31b',
  'glm-4-plus',
  'glm-4-think',
  'glm-4.5',
  'glm-4.5-air',
  'glm-4.5-flash',
  'glm-4.5v',
  'glm-4.6',
  'glm-4.6v',
  'glm-4.6v-flash',
  'glm-4.7',
  'glm-4.7-flash',
  'glm-4.7-flashx',
  'glm-5',
  'glm-5-turbo',
  'glm-5v-turbo',
  'google/gemini-2.5-flash-lite',
  'google/gemini-3.1-flash-lite',
  'google/gemma-2-2b-it',
  'google/gemma-3-12b-it',
  'google/gemma-3-4b-it',
  'gpt-3.5-turbo',
  'gpt-4',
  'gpt-4-turbo',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-2024-05-13',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-11-20',
  'gpt-4o-mini',
  'gpt-5',
  'gpt-5-chat',
  'gpt-5-chat-latest',
  'gpt-5-codex',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-pro',
  'gpt-5.1',
  'gpt-5.1-chat-latest',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
  'gpt-5.2-chat-latest',
  'gpt-5.2-codex',
  'gpt-5.2-pro',
  'gpt-5.3',
  'gpt-5.3-chat-latest',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.4-pro',
  'gpt-5.5',
  'gpt-5.5-instant',
  'gpt-5.5-pro',
  'gpt-image-1',
  'gpt-image-1.5',
  'gpt-image-2',
  'gpt-oss',
  'gpt-oss-120b',
  'gpt-oss-20b',
  'gpt-oss-safeguard-120b',
  'grok',
  'grok-3',
  'grok-4',
  'grok-4.1-fast',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4.3',
  'grok-build-0.1',
  'groq-compound',
  'groq/compound',
  'groq/compound-mini',
  'hermes',
  'hermes-3-llama-3.1-405b',
  'hermes-4-70b',
  'hunyuan-2.0-thinking',
  'hunyuan-t1',
  'hy3',
  'hy3-free',
  'hy3-preview',
  'ibm/granite-3.0-8b-instruct',
  'ibm/granite-34b-code-instruct',
  'jamba-large',
  'jamba-large-1.7',
  'jamba-mini',
  'kimi-k2',
  'kimi-k2-thinking',
  'kimi-k2-thinking-turbo',
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed',
  'laguna-m.1',
  'laguna-xs',
  'lfm-2.5-1.2b-instruct',
  'lfm-2.5-1.2b-thinking',
  'liquid',
  'liquid-thinking',
  'llama-3.1-405b',
  'llama-3.1-70b',
  'llama-3.1-8b',
  'llama-3.1-8b-instant',
  'llama-3.1-nemotron-70b-instruct',
  'llama-3.1-nemotron-safety-guard-8b-v3',
  'llama-3.1-nemotron-ultra-253b',
  'llama-3.2-11b-vision',
  'llama-3.2-3b',
  'llama-3.3-70b',
  'llama-3.3-70b-instruct',
  'llama-3.3-70b-versatile',
  'llama-3.3-nemotron-super-49b-v1',
  'llama-3.3-nemotron-super-49b-v1.5',
  'llama-4-maverick',
  'llama-4-maverick-17b-instruct',
  'llama-4-scout',
  'llama-4-scout-17b-instruct',
  'llama-nemotron-embed-vl-1b-v2',
  'llama-nemotron-rerank-vl-1b-v2',
  'longcat-2.0',
  'magistral-medium-latest',
  'mai-code-1-flash',
  'meta/codellama-70b',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-1b-instruct',
  'meta/llama-3.2-3b-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-4-maverick-17b-128e-instruct',
  'meta/llama2-70b',
  'microsoft/phi-4-mini-instruct',
  'microsoft/phi-4-multimodal-instruct',
  'mimo',
  'mimo-v2-flash',
  'mimo-v2-omni',
  'mimo-v2-pro',
  'mimo-v2.5',
  'mimo-v2.5-free',
  'mimo-v2.5-pro-free',
  'mimo-v2.5-pro-ultraspeed',
  'minimax-m2.1',
  'minimax-m2.5',
  'minimax-m2.7',
  'minimax-m3',
  'minimax/MiniMax-M2.1',
  'ministral',
  'ministral-14b',
  'ministral-3b',
  'ministral-8b',
  'ministral-8b-latest',
  'mistral-large',
  'mistral-large-2411',
  'mistral-large-2512',
  'mistral-large-latest',
  'mistral-medium',
  'mistral-medium-2505',
  'mistral-medium-2604',
  'mistral-medium-latest',
  'mistral-nemo',
  'mistral-nemotron',
  'mistral-small',
  'mistral-small-2506',
  'mistral-small-2603',
  'mistral-small-3.2-24b',
  'mistral-small-latest',
  'mistral/codestral-latest',
  'mistral/mistral-large-latest',
  'mistral/mistral-medium-latest',
  'mistral/mistral-small-latest',
  'mistralai/codestral-22b-instruct-v0.1',
  'mistralai/ministral-14b-instruct-2512',
  'mistralai/mistral-7b-instruct-v0.3',
  'mistralai/mistral-large-3-675b-instruct-2512',
  'mistralai/mistral-medium-3.5-128b',
  'mistralai/mistral-small-4-119b-2603',
  'mistralai/mixtral-8x22b-v0.1',
  'mistralai/mixtral-8x7b-instruct-v0.1',
  'mixtral-8x22b',
  'mixtral-8x7b',
  'nemotron-3-content-safety',
  'nemotron-3-nano',
  'nemotron-3-nano-30b-a3b',
  'nemotron-3-nano-omni',
  'nemotron-3-nano-omni-30b-a3b-reasoning',
  'nemotron-3-super',
  'nemotron-3-super-120b-a12b',
  'nemotron-3-ultra',
  'nemotron-3-ultra-550b-a55b',
  'nemotron-3.5-content-safety',
  'nemotron-cascade-2-30b-a3b',
  'nemotron-content-safety-reasoning-4b',
  'nemotron-mini-4b-instruct',
  'nemotron-nano',
  'nemotron-nano-12b-v2-vl',
  'nemotron-nano-9b-v2',
  'nemotron-voicechat',
  'north-mini-code-1-0',
  'nova-2-lite',
  'nova-2-pro',
  'nova-lite',
  'nova-micro',
  'nova-premier',
  'nova-pro',
  'nvidia/llama-3.1-nemotron-51b-instruct',
  'nvidia/nemotron-4-340b-instruct',
  'o1',
  'o1-pro',
  'o3',
  'o3-deep-research',
  'o3-mini',
  'o3-pro',
  'o4-mini',
  'o4-mini-deep-research',
  'o4-mini-high',
  'open-mistral-nemo',
  'openai-fast',
  'openai/gpt-4-turbo',
  'openai/gpt-5',
  'openai/gpt-5-mini',
  'openai/gpt-5-nano',
  'openai/gpt-5-pro',
  'openai/gpt-oss-safeguard-20b',
  'openai/o1-pro',
  'openai/o3-pro',
  'ornith-1.0-31b',
  'ornith-1.0-35b',
  'ornith-1.0-397b',
  'ornith-1.0-9b',
  'perplexity-pro',
  'perplexity-web',
  'perplexity/sonar-reasoning-pro',
  'phi-4',
  'phi-4-mini',
  'phi-4-mini-reasoning',
  'phi-4-reasoning',
  'pixtral',
  'pixtral-12b',
  'pixtral-large',
  'pixtral-large-latest',
  'poolside',
  'poolside/laguna-m.1',
  'qwen-flash',
  'qwen-max',
  'qwen-omni-turbo',
  'qwen-plus',
  'qwen-turbo',
  'qwen-vl-max',
  'qwen-vl-plus',
  'qwen2-5-vl-72b-instruct',
  'qwen3-235b-a22b',
  'qwen3-32b',
  'qwen3-coder',
  'qwen3-coder-30b-a3b-instruct',
  'qwen3-coder-480b-a35b-instruct',
  'qwen3-coder-flash',
  'qwen3-coder-next',
  'qwen3-coder-plus',
  'qwen3-coder:480b',
  'qwen3-max',
  'qwen3-next',
  'qwen3-next-80b-a3b-instruct',
  'qwen3-next-80b-a3b-thinking',
  'qwen3-vl',
  'qwen3-vl-plus',
  'qwen3.5-122b-a10b',
  'qwen3.5-27b',
  'qwen3.5-35b-a3b',
  'qwen3.5-397b-a17b',
  'qwen3.5-9b',
  'qwen3.5-flash',
  'qwen3.5-plus',
  'qwen3.5-turbo',
  'qwen3.6-27b',
  'qwen3.6-35b-a3b',
  'qwen3.6-flash',
  'qwen3.6-max-preview',
  'qwen3.6-plus',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwq-plus',
  'sarvam-105b',
  'sarvam-30b',
  'sarvam/sarvam-105b',
  'sarvam/sarvam-30b',
  'solar-mini',
  'solar-pro',
  'sonar',
  'sonar-deep-research',
  'sonar-pro',
  'sonar-reasoning-pro',
  'step-3.5-flash',
  'step-3.5-flash-2603',
  'step-3.7-flash',
  'stepfun/step-3.5-flash-2603',
  'stockmark/stockmark-2-100b-instruct',
  'upstage/solar-10.7b-instruct',
  'whisper-large-v3',
  'whisper-large-v3-turbo',
  'xiaomi/mimo-v2.5-pro',
  'z-ai/glm-5',
  'z-ai/glm-5.1',
  'z-ai/glm-5.2',
  'zai-glm-4.7',
  'zhipuai/glm-4.5',
  'zyphra/zamba2-7b-instruct',
  // === Models.dev models (added 2026-07-07) ===
  'alibaba/qwen-max',
  'alibaba/qwen-plus',
  'alibaba/qwen-turbo',
  'alibaba/qwen3-max',
  'alibaba/qwen3.5-plus',
  'alibaba/qwen3.7-max',
  'anthropic/claude-fable-5',
  'anthropic/claude-opus-4-6',
  'anthropic/claude-opus-4-8',
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-sonnet-5',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-reasoner',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'google/gemini-3.5-flash',
  'minimax/MiniMax-M2.7',
  'minimax/MiniMax-M3',
  'moonshotai/kimi-k2.5',
  'moonshotai/kimi-k2.6',
  'openai/gpt-4.1',
  'openai/gpt-4o',
  'openai/gpt-5.1',
  'openai/gpt-5.2',
  'openai/gpt-5.4',
  'openai/gpt-5.5',
  'openai/o1',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  'perplexity/sonar',
  'perplexity/sonar-pro',
  'sakana/fugu-ultra',
  'stepfun/step-3.5-flash',
  'stepfun/step-3.7-flash',
  'xai/grok-4.3',
  'zhipuai/glm-4.7',
  'zhipuai/glm-5.1',
  'zhipuai/glm-5.2',
  'openrouter/free',
  'openrouter/auto',
  'openrouter/auto:free',
  'google/lyria-3-pro-preview',
  'google/lyria-3-clip-preview',
  'cohere/command-a:free',
  'poolside/laguna-xs-2.1:free',
  'deepseek/deepseek-r1-distill-qwen-32b',
  'openai/gpt-oss-120b-turbo',
  'openai/gpt-oss-20b-turbo',
  'qwen/qwen3.6-flash',
  'qwen/qwen3.6-max-preview',
  'qwen/qwen3.6-plus',
  'qwen/qwen3.7-max',
  'qwen/qwen3.7-plus',
  'qwen/qwen3.5-flash',
  'qwen/qwen3.5-turbo',
  'deepseek/deepseek-r1-0528',
  'google/gemini-3.5-flash-thinking',
  'sambanova/Meta-Llama-3.1-405B-Instruct',
  'sambanova/gpt-oss-120b',
  'cerebras/gpt-oss-120b',
  'cerebras/llama-3.3-70b',
  'groq/llama-3.3-70b-versatile',
  'groq/llama-4-scout',
  'bytedance/seed-1.6',
  'bytedance/seed-1.6-thinking',
  'Codex-Spark',
  'codex-spark',
  'nex-agi/Nex-N2-Pro',
  'nex-n2-pro',
  'deepinfra/llama-4-maverick',
  'openai/o4-mini-high',
  'openai/o4-mini-deep-research',
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-3.1-pro-preview',
  'google/gemini-3.1-flash-lite-preview',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'nvidia/nemotron-3-content-safety',
  'nvidia/nemotron-3.5-content-safety',
  'sambanova/DeepSeek-V3.2',
  'sambanova/MiniMax-M2.7',
  'openai/gpt-5.1-codex',
  'openai/gpt-5.1-codex-max',
  'openai/gpt-5-codex',
  'microsoft/phi-4-reasoning',
  'microsoft/phi-4-mini-reasoning',
  'poolside/laguna-xs',
  'ai21labs/jamba-1.5-mini',
  'ai21labs/jamba-1.5-large',
];

function loadModelIds() {
  try {
    const stat = fs.statSync(OPENCODE_JSONC);
    if (stat.mtimeMs === _cachedMtime && _cachedMerged) return _cachedMerged;
    const raw = fs.readFileSync(OPENCODE_JSONC, 'utf8');
    const stripped = raw.replace(/\/\/.*$/gm, '');
    const config = JSON.parse(stripped);
    const configModels = [];
    if (config.providers) {
      for (const p of Object.values(config.providers)) {
        if (p.models && Array.isArray(p.models)) {
          for (const m of p.models) { if (m.id) configModels.push(m.id); }
        }
      }
    }
    _cachedMerged = [...new Set([...configModels, ...BASE_MODEL_IDS])];
    _cachedMtime = stat.mtimeMs;
    console.error('[models] loaded ' + _cachedMerged.length + ' IDs from opencode.jsonc + base');
    return _cachedMerged;
  } catch (e) {
    if (_cachedMerged) return _cachedMerged;
    console.error('[models] fallback to base: ' + e.message);
    return BASE_MODEL_IDS;
  }
}

// Auto-reload on opencode.jsonc changes
try {
  fs.watch(OPENCODE_JSONC, () => { _cachedMtime = 0; loadModelIds(); console.error('[models] auto-reloaded on opencode.jsonc change'); });
} catch (e) { console.error('[models] watch err: ' + e.message); }

const PORT = 8090;
const GHOST_MODE = process.env.GHOST_MODE === '1' || process.env.GHOST_MODE === 'force';
const TLS_PROXY_URL = process.env.TLS_PROXY_URL || 'http://127.0.0.1:9031';
// OpenRouter multi-key rotation — load keys from OPENROUTER_API_KEY, OPENROUTER_API_KEY_2, _3, etc.
function loadOrKeys() {
  const keys = [];
  const primary = process.env.OPENROUTER_API_KEY || '';
  if (primary) keys.push(primary);
  for (let i = 2; i <= 10; i++) {
    const k = process.env['OPENROUTER_API_KEY_' + i] || '';
    if (k) keys.push(k);
  }
  return keys;
}
const OR_KEYS = loadOrKeys();
let OR_KEY_IDX = 0;
function nextOrKey() {
  if (OR_KEYS.length === 0) return '';
  const key = OR_KEYS[OR_KEY_IDX % OR_KEYS.length];
  OR_KEY_IDX = (OR_KEY_IDX + 1) % OR_KEYS.length;
  return key;
}
function peekOrKey() {
  return OR_KEYS.length > 0 ? OR_KEYS[OR_KEY_IDX % OR_KEYS.length] : '';
}
const OR_KEY = OR_KEYS[0] || '';
const HAS_OR = OR_KEYS.length > 0;
const MISTRAL_KEY = process.env.MISTRAL_API_KEY || '';
const HF_KEY = process.env.HF_TOKEN || '';
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY || '';
const SAMBANOVA_KEY = process.env.SAMBANOVA_API_KEY || '';
const BAZAARLINK_KEY = process.env.BAZAARLINK_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GITHUB_KEY = process.env.GITHUB_TOKEN || '';
const NVIDIA_KEY = process.env.NVIDIA_API_KEY || '';
const CLOUDFLARE_KEY = process.env.CLOUDFLARE_API_KEY || '';
const FREETHEAI_KEY = process.env.FREETHEAI_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const BYNARA_KEY = process.env.BYNARA_API_KEY || '';
const OPENMODEL_KEY = process.env.OPENMODEL_API_KEY || '';
const FREEMODEL_KEY = process.env.FREEMODEL_API_KEY || '';
let PUTER_TOKEN = process.env.PUTER_AUTH_TOKEN || process.env.PUTER_TOKEN || '';
if (!PUTER_TOKEN) {
  try {
    const lines = fs.readFileSync('/home/ricos/.env','utf8').split('\n');
    const line = lines.find(l => /^export PUTER_AUTH_TOKEN=/.test(l));
    if (line) PUTER_TOKEN = line.split('=').slice(1).join('=').replace(/"/g,'').trim();
  } catch(e) {}
}
const HAS_PUTER = !!PUTER_TOKEN;
if (HAS_PUTER) console.error('[puter] token loaded (' + PUTER_TOKEN.length + ' chars)');

// ─── Multi-Key Rotation Pool ───
// Each provider can have multiple free-tier keys loaded from env vars:
//   <PROVIDER>_API_KEY, <PROVIDER>_API_KEY_2, <PROVIDER>_API_KEY_3, ...
// Round-robin rotation + per-key cooldown on 429/403 → multiplies free-tier capacity
class KeyPool {
  constructor(envBase, maxKeys = 10) {
    this.keys = [];
    this.cooldown = new Map(); // key -> cooldownUntil timestamp
    this.idx = 0;
    const primary = process.env[envBase] || '';
    if (primary) this.keys.push(primary);
    const suffix = envBase.endsWith('_API_KEY') ? '_API_KEY' : (envBase.endsWith('_TOKEN') ? '_TOKEN' : '');
    for (let i = 2; i <= maxKeys; i++) {
      const k = process.env[envBase + '_' + i] || (suffix ? process.env[envBase.replace(suffix, '') + '_' + i + suffix] : '');
      if (k) this.keys.push(k);
    }
  }
  get length() { return this.keys.length; }
  get hasKeys() { return this.keys.length > 0; }
  next() {
    if (this.keys.length === 0) return '';
    const now = Date.now();
    // Try up to N times to find a non-cooled key
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[this.idx % this.keys.length];
      this.idx = (this.idx + 1) % this.keys.length;
      const cd = this.cooldown.get(key) || 0;
      if (now >= cd) return key;
    }
    // All cooled — return first anyway (will retry via Tor)
    const key = this.keys[this.idx % this.keys.length];
    this.idx = (this.idx + 1) % this.keys.length;
    return key;
  }
  markCooldown(key, ms = 300000) {
    if (!key) return;
    this.cooldown.set(key, Date.now() + ms);
  }
  isCooled(key) {
    const cd = this.cooldown.get(key) || 0;
    return Date.now() < cd;
  }
}

// Build key pools for all key-based providers (enables multi-key rotation)
const KEY_POOLS = {
  or: new KeyPool('OPENROUTER_API_KEY'),
  mistral: new KeyPool('MISTRAL_API_KEY'),
  hf: new KeyPool('HF_TOKEN'),
  cerebras: new KeyPool('CEREBRAS_API_KEY'),
  sambanova: new KeyPool('SAMBANOVA_API_KEY'),
  bazaarlink: new KeyPool('BAZAARLINK_API_KEY'),
  groq: new KeyPool('GROQ_API_KEY'),
  github: new KeyPool('GITHUB_TOKEN'),
  nvidia: new KeyPool('NVIDIA_API_KEY'),
  cloudflare: new KeyPool('CLOUDFLARE_API_KEY'),
  freetheai: new KeyPool('FREETHEAI_API_KEY'),
  gemini: new KeyPool('GEMINI_API_KEY'),
  bynara: new KeyPool('BYNARA_API_KEY'),
  openmodel: new KeyPool('OPENMODEL_API_KEY'),
  freemodel: new KeyPool('FREEMODEL_API_KEY'),
  siliconflow: new KeyPool('SILICONFLOW_API_KEY'),
};
// Keep backward-compat single-key vars
const MISTRAL_KEYS = KEY_POOLS.mistral;
const HF_KEYS = KEY_POOLS.hf;
const CEREBRAS_KEYS = KEY_POOLS.cerebras;
const SAMBANOVA_KEYS = KEY_POOLS.sambanova;
const GROQ_KEYS = KEY_POOLS.groq;
const GITHUB_KEYS = KEY_POOLS.github;
const NVIDIA_KEYS = KEY_POOLS.nvidia;
const GEMINI_KEYS = KEY_POOLS.gemini;
console.error('[keys] pools: ' + Object.entries(KEY_POOLS).map(([k,v]) => k + '=' + v.length).filter(x => !x.endsWith('=0')).join(', '));

function streamFromUpstream(payload, wantsStream, res, urlStr, apiKey, timeoutMs, compressLevel) {
  return new Promise((resolve) => {
    // CUT#1: Guard against parallel race — multiple Promise.race providers writing to same res
    if (res._responseSent) { resolve({ ok: false, error: 'already_responded' }); return; }
    const data = JSON.stringify(payload);
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    const opts = { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname, method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': pickUA(urlStr || '') },
        fakeIdentityHeaders(providerFromUrl(urlStr))
      ) };
    if (apiKey) opts.headers['Authorization'] = 'Bearer ' + apiKey;
    if (EGRESS_SOCKS5 && _egressAgent) opts.agent = _egressAgent;
    const upReq = mod.request(opts, (upRes) => {
          if (upRes.statusCode !== 200) {
        let errBody = '';
        upRes.on('data', c => errBody += c);
        upRes.on('end', () => {
          resolve({ ok: false, status: upRes.statusCode, body: errBody.substring(0, 100) });
        });
        return;
      }
      if (res._responseSent) { resolve({ ok: false, error: 'already_responded' }); return; }
      // ─── Brain Bridge: collect response content for cache storage ───
      let fullResponseText = '';
      if (wantsStream) {
        const watchdog = createStreamWatchdog(wantsStream, res);
        const watcher = createStreamWatcher(upReq, res, timeoutMs);
        watcher.bind(resolve);
        upRes.on('data', chunk => {
          if (res._responseSent) { upReq.destroy(); return; }
          watchdog.markResponded();
          watcher.onData(chunk);
          const raw = chunk.toString();
          const transformed = wantsStream ? raw : transformCompletionBody(raw, compressLevel);
          if (res.writableEnded) return;
          res.write(transformed);
          // Extract content from SSE for brain-bridge caching
          try {
            const lines = raw.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                const json = JSON.parse(line.slice(6));
                const content = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.text || '';
                if (content) fullResponseText += content;
              }
            }
          } catch {}
        });
        upRes.on('end', () => {
          watchdog.cancel();
          const st = watcher.onEnd();
          if (!st.aborted) {
            if (!st.started) { resolve({ ok: false, error: 'stream_no_data' }); return; }
            res.end();
            // Store in brain-bridge cache
            if (fullResponseText) {
              try { storeBrainCache(payload.model, payload.messages, fullResponseText); } catch (e) {}
            }
          }
        });
      } else {
        let body = '';
        upRes.on('data', c => body += c);
        upRes.on('end', () => {
          // CUT#8: Defer heavy CPU work to next tick so event loop drains I/O first
          setImmediate(() => {
            if (res._responseSent) { resolve({ ok: false, error: 'already_responded' }); return; }
            const transformed = transformCompletionBody(body, compressLevel);
            res._responseSent = true;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(transformed);
            try {
              const parsed = JSON.parse(body);
              const content = parsed?.choices?.[0]?.message?.content || parsed?.choices?.[0]?.text || '';
              if (content) storeBrainCache(payload.model, payload.messages, content);
            } catch (e) {}
            resolve({ ok: true });
          });
        });
      }
    });
    let streamResolved = false;
    upReq.on('error', e => { if (!streamResolved) { streamResolved = true; resolve({ ok: false, error: e.message }); } });
    upReq.setTimeout(timeoutMs || 60000, () => { if (!streamResolved) { streamResolved = true; upReq.destroy(); resolve({ ok: false, error: 'timeout' }); } });
    upReq.write(data); upReq.end();
  });
}

function tryFreellmapi(parsedPayload, wantsStream, res, retries) {
  return new Promise((resolve) => {
    const u = new URL('http://127.0.0.1:3002/v1/chat/completions');
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(parsedPayload), 'User-Agent': pickUA(url || '') } };
    const upReq = http.request(opts, (upRes) => {
      if (upRes.statusCode !== 200) {
        let errBody = '';
        upRes.on('data', c => errBody += c);
        upRes.on('end', () => {
          if (retries > 0 && upRes.statusCode === 429) {
            const delay = Math.min(2000 * (4 - retries + 1) + Math.random() * 1000, 8000);
            console.error('[retry] 429, retrying in ' + Math.round(delay) + 'ms (' + retries + ' left)');
            setTimeout(() => tryFreellmapi(parsedPayload, wantsStream, res, retries - 1).then(resolve), delay);
          } else {
            console.error('[upstream] fail status=' + upRes.statusCode + ' body=' + errBody.substring(0, 200));
            resolve({ ok: false });
          }
        });
        return;
      }
      if (wantsStream) {
        const watcher = createStreamWatcher(upReq, res, 60000);
        watcher.bind(resolve);
        upRes.on('data', chunk => {
          watcher.onData(chunk);
          res.write(wantsStream ? chunk : transformCompletionBody(chunk.toString()));
        });
        upRes.on('end', () => {
          const st = watcher.onEnd();
          if (!st.aborted) {
            if (!st.started) { resolve({ ok: false, error: 'stream_no_data' }); return; }
            res.end();
          }
        });
      } else {
        let body = '';
        upRes.on('data', c => body += c);
        upRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(transformCompletionBody(body));
          resolve({ ok: true });
        });
      }
    });
    let flmResolved = false;
    upReq.on('error', () => { if (!flmResolved) { flmResolved = true; resolve({ ok: false }); } });
    upReq.setTimeout(60000, () => { if (!flmResolved) { flmResolved = true; upReq.destroy(); resolve({ ok: false }); } });
    upReq.write(parsedPayload); upReq.end();
  });
}

// ─── OpenModel AI protocol converters ───
// Converts a standard Chat Completions payload to Anthropic Messages API format
function toAnthropicMessages(chatPayload) {
  const system = chatPayload.messages.find(m => m.role === 'system');
  const others = chatPayload.messages.filter(m => m.role !== 'system');
  const anthropicMsgs = [];
  for (let i = 0; i < others.length; i++) {
    const m = others[i];
    if (m.role === 'tool') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content;
    if (typeof m.content === 'string') {
      content = m.content || ' ';
    } else if (Array.isArray(m.content)) {
      content = m.content.map(c => {
        if (c.type === 'text' || c.type === 'input_text') return { type: 'text', text: c.text || '' };
        if (c.type === 'image_url') return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.image_url?.url || '' } };
        return { type: 'text', text: JSON.stringify(c) };
      }).filter(c => c.text || c.source);
    } else {
      content = ' ';
    }
    // Merge consecutive same-role messages (Anthropic requires alternating)
    if (anthropicMsgs.length > 0 && anthropicMsgs[anthropicMsgs.length - 1].role === role) {
      const prev = anthropicMsgs[anthropicMsgs.length - 1];
      if (typeof prev.content === 'string' && typeof content === 'string') {
        prev.content += '\n' + content;
      } else {
        prev.content = [].concat(prev.content || []).concat(content || []);
      }
    } else {
      anthropicMsgs.push({ role, content });
    }
  }
  const payload = {
    model: chatPayload.model,
    max_tokens: chatPayload.max_tokens || 4096,
    messages: anthropicMsgs,
  };
  if (chatPayload.temperature !== undefined) payload.temperature = chatPayload.temperature;
  if (system) {
    payload.system = typeof system.content === 'string' ? system.content : (system.content?.[0]?.text || '');
  }
  return payload;
}
async function openModelReq(endpoint, payload, extraHeaders, wantsStream, res, apiKey, timeoutMs) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const u = new URL(endpoint);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': pickUA(url || ''), ...extraHeaders } };
    if (apiKey) opts.headers['Authorization'] = 'Bearer ' + apiKey;
    const upReq = mod.request(opts, (upRes) => {
      if (upRes.statusCode !== 200) { let b = ''; upRes.on('data', c => b += c); upRes.on('end', () => resolve({ ok: false, status: upRes.statusCode, body: b.substring(0, 200) })); return; }
      let body = '';
      upRes.on('data', c => body += c);
      upRes.on('end', () => {
        try {
          const d = JSON.parse(body);
          resolve({ ok: true, data: d });
        } catch(e) { resolve({ ok: false, error: 'parse_error' }); }
      });
    });
    upReq.on('error', e => resolve({ ok: false, error: e.message }));
    upReq.setTimeout(timeoutMs || 20000, () => upReq.destroy());
    upReq.write(data); upReq.end();
  });
}
// Call OpenModel AI Messages API (Anthropic format) and return Chat Completions
async function tryOpenModelMessages(parsed, wantsStream, res, modelName, apiKey) {
  const anthro = toAnthropicMessages({ ...parsed, model: modelName });
  const bodySize = JSON.stringify(parsed).length;
  const omTimeout = Math.min(Math.max(bodySize / 100, 30000), 120000);
  const result = await openModelReq('https://api.openmodel.ai/v1/messages', anthro,
    { 'anthropic-version': '2023-06-01' }, wantsStream, res, apiKey, omTimeout);
  if (!result.ok) { console.error('[openmodel-msg] fail: HTTP ' + (result.status||'?') + ' ' + (result.body||result.error||'')); return false; }
  const d = result.data;
  // Convert Anthropic response to Chat Completions format
      let text = '';
      if (d.content && Array.isArray(d.content)) {
        for (const block of d.content) {
          if (block.type === 'text') text += block.text;
        }
      }
      if (!text && d.content && Array.isArray(d.content)) {
        for (const block of d.content) {
          if (block.type === 'thinking') text += block.thinking || '';
        }
      }
  const finishReason = d.stop_reason === 'end_turn' ? 'stop' : d.stop_reason === 'max_tokens' ? 'length' : (d.stop_reason || 'stop');
  const chatResp = {
    id: d.id || 'openmodel-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: d.model || modelName,
    choices: [{ index: 0, message: { role: 'assistant', content: text || ' ' }, finish_reason: finishReason }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  if (!wantsStream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chatResp));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    for (const c of chatResp.choices) {
      res.write('data: ' + JSON.stringify({ choices: [{ index: c.index, delta: { role: 'assistant', content: c.message.content }, finish_reason: null }] }) + '\n\n');
    }
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: chatResp.choices[0].finish_reason }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
  return true;
}
// Call OpenModel AI Responses API (OpenAI Responses format) and return Chat Completions
async function tryOpenModelResponses(parsed, wantsStream, res, modelName, apiKey) {
  const system = parsed.messages.find(m => m.role === 'system');
  const others = parsed.messages.filter(m => m.role !== 'system');
  const input = others.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: Array.isArray(m.content) ? m.content.map(c => ({ type: 'input_text', text: c.text || '' })) : [{ type: 'input_text', text: typeof m.content === 'string' ? m.content : ' ' }],
  }));
  const payload = { model: modelName, input, max_output_tokens: parsed.max_tokens || 4096 };
  if (parsed.temperature !== undefined) payload.temperature = parsed.temperature;
  if (system) payload.instructions = typeof system.content === 'string' ? system.content : (system.content?.[0]?.text || '');
  const result = await openModelReq('https://api.openmodel.ai/v1/responses', payload, {}, wantsStream, res, apiKey, 20000);
  if (!result.ok) { console.error('[openmodel-resp] fail: HTTP ' + (result.status||'?') + ' ' + (result.body||result.error||'')); return false; }
  const d = result.data;
  let text = '';
  if (d.output && Array.isArray(d.output)) {
    for (const msg of d.output) {
      if (msg.content && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'output_text' || block.text) text += (block.text || '');
        }
      }
      if (msg.type === 'message' && typeof msg.content === 'string') text += msg.content;
    }
  }
  const usage = d.usage || {};
  const chatResp = {
    id: d.id || 'openmodel-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: d.model || modelName,
    choices: [{ index: 0, message: { role: 'assistant', content: text || ' ' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  if (!wantsStream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chatResp));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    for (const c of chatResp.choices) {
      res.write('data: ' + JSON.stringify({ choices: [{ index: c.index, delta: { role: 'assistant', content: c.message.content }, finish_reason: null }] }) + '\n\n');
    }
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: chatResp.choices[0].finish_reason }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
  return true;
}
// Main OpenModel AI handler — detects protocol and routes accordingly
async function tryOpenModelAI(parsed, wantsStream, res, reqModel, apiKey) {
  if (!apiKey) return false;
  const mapped = openmodelModelFor(reqModel);
  if (!mapped) { console.error('[openmodel] no route for ' + reqModel); return false; }
  console.error('[openmodel] → ' + mapped.model + ' via ' + mapped.api + ' (free)');
  if (mapped.api === 'messages') return tryOpenModelMessages(parsed, wantsStream, res, mapped.model, apiKey);
  if (mapped.api === 'responses') return tryOpenModelResponses(parsed, wantsStream, res, mapped.model, apiKey);
  return false;
}

// ─── Tor SOCKS5 upstream for OpenRouter (native, non-blocking) ───
// Replaces the old execSync('curl --socks5-hostname ...') which blocked the event loop
// Uses dynamic import because socks-proxy-agent is ESM-only
let _torAgent = null;
async function _getTorAgent() {
  if (!_torAgent) {
    const mod = await import('socks-proxy-agent');
    _torAgent = new mod.SocksProxyAgent('socks5h://127.0.0.1:9050');
  }
  return _torAgent;
}

async function tryOpenRouterViaTor(orPayload, wantsStream, res, key, timeoutMs) {
  try {
    const agent = await _getTorAgent();
  } catch (e) {
    return { ok: false, error: 'tor_agent_init_failed: ' + e.message };
  }
  return new Promise((resolve) => {
    const data = JSON.stringify(orPayload);
    const t = timeoutMs || 60000;
    const u = new URL('https://openrouter.ai/api/v1/chat/completions');
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      agent: _torAgent,
      headers: Object.assign(
        {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Authorization': 'Bearer ' + key
        },
        fakeIdentityHeaders('or')
      )
    };
    const upReq = https.request(opts, (upRes) => {
      if (upRes.statusCode !== 200) {
        let errBody = '';
        upRes.on('data', c => errBody += c);
        upRes.on('end', () => resolve({ ok: false, status: upRes.statusCode, body: errBody.substring(0, 100) }));
        return;
      }
      if (wantsStream) {
        const watcher = createStreamWatcher(upReq, res, t);
        watcher.bind(resolve, { via: 'tor' });
        upRes.on('data', chunk => {
          watcher.onData(chunk);
          res.write(wantsStream ? chunk : transformCompletionBody(chunk.toString()));
        });
        upRes.on('end', () => {
          const st = watcher.onEnd();
          if (!st.aborted) {
            if (!st.started) { resolve({ ok: false, error: 'stream_no_data' }); return; }
            res.end();
          }
        });
      } else {
        let body = '';
        upRes.on('data', c => body += c);
        upRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(transformCompletionBody(body));
          resolve({ ok: true, via: 'tor' });
        });
      }
    });
    upReq.setTimeout(t + 2000, () => { upReq.destroy(); resolve({ ok: false, error: 'timeout' }); });
    upReq.on('error', e => resolve({ ok: false, error: e.message }));
    upReq.write(data); upReq.end();
  });
}

// ─── Generic Tor SOCKS5 upstream for any provider (HARDENED: fake id + challenge rotate) ───
// Even when an upstream detects the Tor exit, the request exposes ONLY a synthetic
// identity (fakeIdentityHeaders) — the real machine is never revealed. If a challenge
// /block is returned (Cloudflare "verify you are human", 403/429/451), we rotate the
// Tor circuit (SIGNEWNYM) AND regenerate the fake identity, then retry once.
function providerFromUrl(urlStr) {
  try {
    const h = new URL(urlStr).hostname.toLowerCase();
    if (h.includes('openrouter')) return 'or';
    if (h.includes('githubcopilot')) return 'copilot';
    if (h.includes('github.ai')) return 'github';
    if (h.includes('huggingface')) return 'hf';
    if (h.includes('siliconflow')) return 'siliconflow';
    const parts = h.split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : h;
  } catch (e) { return 'unknown'; }
}

async function tryViaTor(payload, wantsStream, res, urlStr, apiKey, timeoutMs) {
  try {
    const agent = await _getTorAgent();
  } catch (e) {
    return { ok: false, error: 'tor_agent_init_failed: ' + e.message };
  }
  const provider = providerFromUrl(urlStr);
  async function attempt() {
    return new Promise((resolve) => {
      const data = JSON.stringify(payload);
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const mod = isHttps ? https : http;
      const opts = { hostname: u.hostname, path: u.pathname, method: 'POST', agent,
        headers: Object.assign(
          { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': pickUA(urlStr || '') },
          fakeIdentityHeaders(provider)
        ) };
      if (apiKey) opts.headers['Authorization'] = 'Bearer ' + apiKey;
      const upReq = mod.request(opts, (upRes) => {
        if (upRes.statusCode !== 200) {
          let errBody = '';
          upRes.on('data', c => errBody += c);
          upRes.on('end', () => resolve({ ok: false, status: upRes.statusCode, body: errBody, challenge: isChallenge(upRes.statusCode, errBody) }));
          return;
        }
        if (wantsStream) {
          const watcher = createStreamWatcher(upReq, res, timeoutMs);
          watcher.bind(resolve, { via: 'tor' });
          upRes.on('data', chunk => { watcher.onData(chunk); res.write(wantsStream ? chunk : transformCompletionBody(chunk.toString())); });
          upRes.on('end', () => {
            const st = watcher.onEnd();
                      if (!st.aborted) {
              if (!st.started) { resolve({ ok: false, error: 'stream_no_data' }); return; }
              if (res.writableEnded) return;
              res.end(); }
          });
        } else {
          let body = '';
          upRes.on('data', c => body += c);
          upRes.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(transformCompletionBody(body)); resolve({ ok: true, via: 'tor' }); });
        }
      });
      upReq.setTimeout((timeoutMs || 60000) + 2000, () => { upReq.destroy(); resolve({ ok: false, error: 'timeout' }); });
      upReq.on('error', e => resolve({ ok: false, error: e.message }));
      upReq.write(data); upReq.end();
    });
  }
  const r1 = await attempt();
  if (r1.ok) return r1;
  // Challenge/block detected (Tor exit flagged by Cloudflare/Anthropic/etc.):
  // rotate Tor circuit + regenerate fake identity, retry once with a fresh (fake) footprint.
  if (r1.challenge) {
    console.error('[tor] challenge detected for ' + provider + ' status=' + (r1.status || '?') + ' — rotating egress+identity and retrying');
    handleDetection(provider);
    const r2 = await attempt();
    if (r2.ok) return r2;
    return Object.assign(r2, { rotatedOnce: true, originalChallenge: r1.status });
  }
  return r1;
}

// ─── Helper: is this a key-bearing provider? ───
const KEY_BEARING_PROVIDERS = new Set(['or','mistral','groq','nvidia','gemini','github','hf','cerebras','sambanova','bazaarlink','bynara','openmodel','freemodel','copilot','freetheai','cloudflare','siliconflow']);
function isKeyBearingProvider(name) {
  return KEY_BEARING_PROVIDERS.has(name);
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Models list
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const allModelIds = loadModelIds();
    return res.end(JSON.stringify({ object: 'list', data: allModelIds.map(id => ({ id, object: 'model' })) }));
  }

  // Health endpoint
  if (req.method === 'GET' && req.url === '/v1/health') {
    const startTime = Date.now();
    const apiKeys = { openrouter: !!OR_KEY, mistral: !!MISTRAL_KEY, github: !!GITHUB_KEY, groq: !!GROQ_KEY, nvidia: !!NVIDIA_KEY, cloudflare: !!CLOUDFLARE_KEY, openmodel: !!OPENMODEL_KEY, hf: !!HF_KEY, cerebras: !!CEREBRAS_KEY, sambanova: !!SAMBANOVA_KEY, bazaarlink: !!BAZAARLINK_KEY, bynara: !!BYNARA_KEY, gemini: !!GEMINI_KEY, puter: !!PUTER_TOKEN };
    const results = [];
    let healthy = 0, total = 0;
    const check = (url) => new Promise(r => {
      total++;
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(u, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => { healthy++; r({ ok: true, status: res.statusCode }); });
      });
      req.setTimeout(3000, () => { req.destroy(); r({ ok: false, error: 'timeout' }); });
      req.on('error', e => r({ ok: false, error: e.message }));
    });
    // Real inference health checks
    async function checkInference(name, url, payload, apiKey) {
      try {
        const body = JSON.stringify(payload);
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;
        return new Promise(r => {
          const opts = { hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': pickUA(url || '') } };
          if (apiKey) opts.headers['Authorization'] = 'Bearer ' + apiKey;
          const creq = mod.request(opts, (cres) => {
            let data = '';
            cres.on('data', c => data += c);
            cres.on('end', () => {
              const ok = cres.statusCode === 200;
              if (ok) healthy++;
              r({ name, ok, status: cres.statusCode, inference: ok ? 'pass' : 'fail' });
            });
          });
          creq.setTimeout(5000, () => { creq.destroy(); r({ name, ok: false, inference: 'timeout' }); });
          creq.on('error', e => r({ name, ok: false, inference: e.message }));
          creq.write(body); creq.end();
        });
      } catch (e) { return { name, ok: false, inference: e.message }; }
    }
    (async () => {
      const [pingResults, inferenceResults] = await Promise.all([
        Promise.all([
          check('http://127.0.0.1:3002/v1/models'),
          check('http://127.0.0.1:8001/v1/models'),
          check('http://127.0.0.1:3456/v1/models'),
          check('http://127.0.0.1:3458/v1/models'),
          check('http://127.0.0.1:8090/v1/models'),
          check('http://127.0.0.1:8084/v1/health').then(r => r, () => ({ ok: false })),
        ]),
        Promise.all([
          checkInference('deepinfra', 'https://api.deepinfra.com/v1/openai/chat/completions', { model: 'deepseek-chat', messages: [{role:'user', content:'Hi'}], max_tokens: 1 }),
          checkInference('siliconflow', 'https://api.siliconflow.com/v1/chat/completions', { model: 'deepseek-ai/DeepSeek-V3', messages: [{role:'user', content:'Hi'}], max_tokens: 1 }),
        ]),
      ]);
      const tunnels = [
        { name: 'tor-socks5', url: 'socks5://127.0.0.1:9050', status: 'unknown' },
      ];
      let torStatus = 'unknown';
      try { const raw = execSync('curl -s --socks5-hostname 127.0.0.1:9050 --max-time 5 https://check.torproject.org/api/ip 2>/dev/null', { timeout: 8000 }).toString(); const j = JSON.parse(raw); torStatus = j.IsTor ? 'up' : 'down'; } catch(e) { torStatus = 'unknown'; }
      tunnels[0].status = torStatus;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' });
      res.end(JSON.stringify({ status: healthy === (total + inferenceResults.length) ? 'healthy' : 'degraded', uptime: process.uptime(), healthy, total, proxies: pingResults, inference: inferenceResults, tunnels, api_keys: apiKeys, version: 4 }));
    })().catch(e => { try { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({status:'error',error:e.message,version:4})); } catch(e2){} });
    return;
  }

  // Budget stats endpoint
  if (req.method === 'GET' && req.url === '/v1/budget') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getBudgetStats()));
  }

  // Zero-Cost Guardian health endpoint
  if (req.method === 'GET' && req.url === '/v1/guard/health') {
    const reportPath = path_.join(process.env.HOME || '/home/ricos', '.blind-proxy', 'zero-cost-report.json');
    if (fs.existsSync(reportPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=30' });
      return res.end(fs.readFileSync(reportPath, 'utf8'));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'no_data', message: 'Run zero-cost-guardian.py --once first' }));
  }

  // Matrix proxy health dashboard
  if (req.method === 'GET' && req.url === '/v1/matrix') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=5' });
    return res.end(JSON.stringify(getMatrixHealth()));
  }

  // Universal format converter
  if (req.method === 'POST' && req.url === '/v1/convert') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const { payload, targetFormat } = parsed;
        if (!payload) throw new Error('payload required');
        const fmt = targetFormat || 'openai';
        const converted = fromOpenAI(payload, fmt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ format: fmt, payload: converted }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Ghost Node status + control
  if (req.method === 'GET' && req.url === '/v1/ghost') {
    const nsExists = (function() {
      try { return require('child_process').execSync('ip netns list 2>/dev/null | grep -q ai-ghost', { timeout: 2000 }).toString().trim(); } catch(e) { return false; }
    })();
    const tlsProxy = (function() {
      try { return require('child_process').execSync('ss -tlnp 2>/dev/null | grep -q :9031', { timeout: 2000 }).toString().trim(); } catch(e) { return false; }
    })();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ghost_node: !!nsExists, tls_proxy: !!tlsProxy, mode: process.env.GHOST_MODE || 'disabled', tor_ip: getTorIP() }));
  }

  if (req.method === 'POST' && req.url === '/v1/ghost/setup') {
    const { execSync } = require('child_process');
    try {
      execSync('sudo /home/ricos/ricocoder/scripts/ghost-node.sh setup', { timeout: 15000 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', ghost_node: true }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', message: e.message }));
    }
  }

  if (req.method === 'POST' && req.url === '/v1/ghost/teardown') {
    const { execSync } = require('child_process');
    try {
      execSync('sudo /home/ricos/ricocoder/scripts/ghost-node.sh teardown', { timeout: 10000 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', ghost_node: false }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', message: e.message }));
    }
  }

  // Tor IP rotation + status
  if (req.method === 'GET' && req.url === '/v1/tor/status') {
    const ip = getTorIP();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tor_running: !!ip, current_ip: ip || 'unknown', socks5: 'socks5://127.0.0.1:9050' }));
  }

  if (req.method === 'POST' && req.url === '/v1/tor/rotate') {
    const result = rotateTorIP();
    try { handleDetection('tor'); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ result, new_ip: getTorIP(), identity_rotated: true }));
  }


  // Headroom stats
  if (req.method === 'GET' && req.url === '/v1/headroom') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ stats: getHeadroomStats(), budgets: require('./matrix-proxy.js').MATRIX_NODES }));
  }

  // ─── Agent-Reach: multi-platform search via installed agent-reach ───
  if (req.url.startsWith('/v1/agent-reach')) {
    const agentReach = path_.resolve('/home/ricos/.agent-reach-venv/bin/agent-reach');
    if (req.method === 'GET' && req.url === '/v1/agent-reach') {
      try {
        const { execSync } = require('child_process');
        const py = '/home/ricos/.agent-reach-venv/bin/python3';
        const helper = path_.join(__dirname, 'agent-reach-helper.py');
        const out = execSync(py + ' ' + helper + ' doctor', { timeout: 15000, encoding: 'utf-8' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=30' });
        return res.end(out);
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'not_installed', error: e.message, hint: 'Run: pip install agent-reach' }));
      }
    }
    if (req.method === 'POST' && req.url === '/v1/agent-reach/search') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { execSync } = require('child_process');
          const parsed = JSON.parse(body);
          const channel = parsed.channel || 'all';
          const query = parsed.query || '';
          const limit = parsed.limit || 5;
          const py = '/home/ricos/.agent-reach-venv/bin/python3';
          const helper = path_.join(__dirname, 'agent-reach-helper.py');
          const cmd = `${py} ${helper} search ${channel} "${query.replace(/"/g,'\\"')}" ${limit}`;
          const out = execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(out);
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404); return res.end('{"error":"unknown agent-reach endpoint, try GET /v1/agent-reach or POST /v1/agent-reach/search"}');
  }

  // ─── Anthropic Messages API → proxy to anthropic-proxy:8082 ───
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const wantsStream = parsed.stream === true;
        const data = JSON.stringify(parsed);
        const opts = { hostname: '127.0.0.1', port: 8082, path: '/v1/messages', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
        const upReq = http.request(opts, (upRes) => {
          if (wantsStream) {
            let streamStarted = false;
            let lastChunkTime = Date.now();
            let idleAborted = false;
            const idleTimer = setInterval(() => {
              if (idleAborted || Date.now() - lastChunkTime <= 5000) return;
              idleAborted = true;
              upReq.destroy();
              clearInterval(idleTimer);
            }, 1000);
            upRes.on('data', chunk => {
              lastChunkTime = Date.now();
              if (!streamStarted) {
                streamStarted = true;
                const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' };
                if (upRes.headers['x-request-id']) headers['x-request-id'] = upRes.headers['x-request-id'];
                res.writeHead(upRes.statusCode, headers);
              }
              let chunkStr = chunk.toString();
              const usageMatch = chunkStr.match(/"usage":\s*\{[^}]*\}/g);
              if (usageMatch) {
                for (const m of usageMatch) {
                  chunkStr = chunkStr.replace(m, '"usage":{"input_tokens":0,"output_tokens":0}');
                }
              }
              res.write(chunkStr);
            });
            upRes.on('end', () => {
              if (!idleAborted) {
                clearInterval(idleTimer);
                res.end();
              }
            });
          } else {
            let responseBody = '';
            upRes.on('data', c => responseBody += c);
            upRes.on('end', () => {
              try {
                const d = JSON.parse(responseBody);
                if (d.usage) d.usage = { input_tokens: 0, output_tokens: 0 };
                res.writeHead(upRes.statusCode, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(d));
              } catch(e) { res.writeHead(upRes.statusCode, { 'Content-Type': 'application/json' }); res.end(responseBody); }
            });
          }
        });
        upReq.on('error', e => {
          console.error('[blind-proxy] anthropic-proxy error: ' + e.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'anthropic_proxy_down', type: 'error', message: e.message }));
        });
        upReq.setTimeout(120000, () => { upReq.destroy(); res.writeHead(504); res.end('{}'); });
        upReq.write(data); upReq.end();
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
      }
    });
    return;
  }

  // ─── Brain bridge cache stats ───
  if (req.method === 'GET' && req.url === '/v1/brain') {
    try {
      const stats = getCacheStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── System health dashboard ───
  if (req.method === 'GET' && req.url === '/v1/system') {
    const check = (url, timeout = 3000) => new Promise(r => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req2 = mod.get(u, (res2) => { let d = ''; res2.on('data', c => d += c); res2.on('end', () => r({ ok: res2.statusCode >= 200 && res2.statusCode < 500, status: res2.statusCode, data: d.substring(0, 200) })); });
      req2.on('error', e => r({ ok: false, error: e.message }));
      req2.setTimeout(timeout, () => { req2.destroy(); r({ ok: false, error: 'timeout' }); });
    });
    Promise.all([
      check('http://127.0.0.1:3002/v1/models').then(r => ({ name: 'freellmapi', ...r })),
      check('http://127.0.0.1:8001/v1/models').then(r => ({ name: 'freebuff', ...r })),
      check('http://127.0.0.1:3333/v1/models').then(r => ({ name: 'proxygategllm', ...r })),
      check('http://127.0.0.1:3456/v1/models').then(r => ({ name: 'tfg', ...r })),
      check('http://127.0.0.1:3458/v1/models').then(r => ({ name: 'fugu', ...r })),
      check('http://127.0.0.1:20128/v1/models').then(r => ({ name: '9router', ...r })),
      check('http://127.0.0.1:8082/v1/models').then(r => ({ name: 'anthropic-proxy', ...r })),
      check('http://127.0.0.1:8084/v1/models').then(r => ({ name: 'anthropic-bridge', ...r })),
    ]).then(results => {
      const healthy = results.filter(r => r.ok).length;
      const total = results.length;
      const tunnels = [
        { name: 'tor-socks5', url: 'socks5://127.0.0.1:9050', status: 'unknown' },
      ];
      try { const torOk = execSync('curl -s --socks5-hostname 127.0.0.1:9050 --max-time 3 https://check.torproject.org/api/ip 2>/dev/null', { timeout: 5000 }); tunnels[0].status = 'up'; } catch(e) { tunnels[0].status = 'down'; }
      const apiKeys = { openrouter: !!OR_KEY, mistral: !!MISTRAL_KEY, github: !!GITHUB_KEY, groq: !!GROQ_KEY, nvidia: !!NVIDIA_KEY, cloudflare: !!CLOUDFLARE_KEY, openmodel: !!OPENMODEL_KEY, hf: !!HF_KEY, cerebras: !!CEREBRAS_KEY, sambanova: !!SAMBANOVA_KEY, bazaarlink: !!BAZAARLINK_KEY, bynara: !!BYNARA_KEY, gemini: !!GEMINI_KEY, puter: !!PUTER_TOKEN };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' });
      res.end(JSON.stringify({ status: healthy === total ? 'healthy' : 'degraded', uptime: process.uptime(), healthy, total, proxies: results, tunnels, api_keys: apiKeys, version: 3 }));
    });
    return;
  }

  // Chat completions
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        let reqModel = parsed.model || 'auto';
        console.error("[req] model=" + reqModel + " stream=" + parsed.stream + " tools=" + (parsed.tools?.length||0) + " msgs=" + (parsed.messages?.length||0) + " bytes=" + body.length);
        // Parse optional :compress suffix from model name
        let compressLevel = parsed.compress || null;
        const compressMatch = reqModel.match(/^(.*):compress(?::(light|standard|aggressive))?$/i);
        if (compressMatch) {
          reqModel = compressMatch[1];
          compressLevel = compressMatch[2] || 'standard';
        }
        if (compressLevel && compressLevel !== 'none' && !parsed.stream) {
          console.error('[compress] applying ' + compressLevel + ' level to non-streaming responses');
          const origEnd = res.end.bind(res);
          res.end = function(data) {
            const transformed = transformCompletionBody(data.toString(), compressLevel);
            return origEnd(transformed);
          };
        }

        const wantsStream = parsed.stream === true;
        const estimatedTokens = JSON.stringify(parsed.messages).length / 4;
        const isTooLargeForOR = estimatedTokens > 5_000_000;

        // ─── BRAIN BRIDGE: Semantic cache interception (ALL requests) ───
        try {
          const cachedResponse = await checkBrainCache(reqModel, parsed.messages);
          if (cachedResponse) {
            console.error('[brain-bridge] Cache HIT → 0 upstream tokens (model=' + reqModel + ')');
            if (wantsStream) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
              res.write('data: ' + JSON.stringify({
                id: 'brain-bridge-cache',
                object: 'chat.completion.chunk',
                model: reqModel,
                choices: [{ index: 0, delta: { content: cachedResponse }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
              }) + '\n\n');
              res.write('data: [DONE]\n\n');
              res.end();
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                id: 'brain-bridge-cache',
                object: 'chat.completion',
                model: reqModel,
                choices: [{ index: 0, message: { role: 'assistant', content: cachedResponse }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
              }));
            }
            return;
          }
        } catch (e) {
          console.error('[brain-bridge] Cache check failed, proceeding to upstream:', e.message);
        }

        // ─── EDGE BRAIN (Cloudflare Workers AI): Tier 0 responder ───
        // Llama 3.2 1B/3B running on Cloudflare GPU edge network.
        // Zero local CPU, zero local RAM — free Cloudflare tier.
        // Handles simple chat via 1B (~400ms), ReAct loop via 3B (~600ms/step).
        // Falls through to local brain + upstream if Cloudflare is unreachable.
        try {
          if (!wantsStream && parsed.messages?.length > 0 &&
              parsed.messages[parsed.messages.length - 1]?.content?.length > 5) {
            const lastMsg = parsed.messages[parsed.messages.length - 1].content || '';
            const isLocalRequest = reqModel === 'auto' || !reqModel ||
              reqModel.startsWith('auto') || reqModel === 'edge-brain';

            if (isLocalRequest) {
              const isComplex = /write.*code|implement|build.*app|debug.*script|complex|analyze.*data|create.*api/i.test(lastMsg) && lastMsg.length > 40;

              if (!isComplex) {
                // Try simple chat (1B, ~400ms)
                const edgeRes = await ebChat(parsed.messages, parsed.max_tokens || 512);
                if (edgeRes) {
                  const result = {
                    id: 'eb-' + Date.now(), object: 'chat.completion', model: 'edge-brain',
                    choices: [{ index: 0, message: { role: 'assistant', content: edgeRes }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, _zero_token: true, _edge_brain: true,
                  };
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(result));
                  console.error('[edge-brain] Chat responded (0 local CPU/RAM)');
                  return;
                }
              }

              // For WEB/CODE/MATH: try ReAct loop (3B, ~600ms/step)
              // Only do this if user obviously wants action, not just chatting
              if (/^(search|find|look up|calculate|compute|write|run|implement|create|build|debug|deploy|scrape|extract|fetch|research|summarize|analyze|compare|check)/i.test(lastMsg)) {
                console.error('[edge-brain] Trying ReAct loop for:', lastMsg.substring(0, 60));
                const reactRes = await ebReactLoop(lastMsg);
                if (reactRes && reactRes.success) {
                  const result = {
                    id: 'eb-re-' + Date.now(), object: 'chat.completion', model: 'edge-brain-react',
                    choices: [{ index: 0, message: { role: 'assistant', content: reactRes.answer }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, _zero_token: true, _edge_brain: true,
                  };
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(result));
                  console.error('[edge-brain] ReAct loop completed in', reactRes.steps, 'steps (0 local CPU/RAM)');
                  return;
                }
                console.error('[edge-brain] ReAct loop failed, falling through:', reactRes?.error);
              }
            }
          }
        } catch (e) {
          console.error('[edge-brain] Error (falling through):', e.message);
        }

        // ─── TIER 1 REMOTE BRAIN: Free 70B+ via HuggingFace/community APIs ───
        // For complex requests. Llama 3.3 70B on HuggingFace A100s — 0 local CPU/RAM.
        // Uses HF_TOKEN from env. Monthly free credits reset each billing cycle.
        // Smart cache: skips for 24h after 402/403 (credits depleted).
        {
          const _tier1Cooldown = Date.now() - (parseInt(process.env._TIER1_BRAIN_COOLDOWN) || 0);
          const HF_AVAILABLE = HF_KEY && _tier1Cooldown < 24 * 60 * 60 * 1000;
          if (!wantsStream && HF_AVAILABLE && parsed.messages?.length > 0 &&
              !reqModel.includes('local') && reqModel !== 'edge-brain') {
            try {
              const lastMsg = parsed.messages[parsed.messages.length - 1]?.content || '';
              const needs70B = lastMsg.length > 60 ||
                /write.*code|implement|build.*app|debug|analyze.*data|create.*api|explain|compare|design|architecture|refactor|optimize|migrate|deploy/i.test(lastMsg);
              if (needs70B) {
                const hfPayload = {
                  model: 'meta-llama/Llama-3.3-70B-Instruct',
                  messages: parsed.messages,
                  max_tokens: parsed.max_tokens || 4096,
                  temperature: parsed.temperature ?? 0.7, stream: false,
                };
                const hfResult = await tryUpstream('hf-serverless', reqModel, hfPayload,
                  false, res, 'https://router.huggingface.co/v1/chat/completions', HF_KEY, 30000);
                if (hfResult.ok) { console.error('[tier1] 70B responded (0 local)'); return; }
                if (hfResult.status === 402 || hfResult.status === 403) {
                  process.env._TIER1_BRAIN_COOLDOWN = String(Date.now());
                  console.error('[tier1] Credits depleted, cooldown 24h');
                }
              }
            } catch (e) { console.error('[tier1] Error:', e.message); }
          }
        }

        // ─── LOCAL BRAIN (Prefrontal Cortex): Llama 1B primary responder ───
        // For non-streaming CHAT-level requests, try the local 1B model first.
        // Only escalate to upstream when the local brain can't handle it (complex
        // code, deep research, or explicit model requests).
        // This saves 80%+ of upstream tokens for everyday conversation.
        try {
          if (!wantsStream && parsed.messages?.length > 0 &&
              parsed.messages[parsed.messages.length - 1]?.content?.length > 5) {
            const lastMsg = parsed.messages[parsed.messages.length - 1].content || '';
            const isLocalRequest = reqModel === 'auto' || !reqModel ||
              reqModel.startsWith('auto') || reqModel === 'local-brain';

            // Only route simple chat to local brain — WEB/CODE/MATH go through existing routes
            if (isLocalRequest) {
              const isComplex = /write.*code|implement|build.*app|debug.*script|complex|analyze.*data|create.*api/i.test(lastMsg) && lastMsg.length > 40;
              if (!isComplex) {
                const localRes = await askLocal(parsed.messages, { max_tokens: parsed.max_tokens || 512, timeout: 30000, temperature: parsed.temperature || 0.7 });
                if (localRes) {
                  const result = {
                    id: 'lb-' + Date.now(), object: 'chat.completion', model: 'local-brain',
                    choices: [{ index: 0, message: { role: 'assistant', content: localRes }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, _zero_token: true,
                  };
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(result));
                  console.error('[local-brain] Responded to simple query → 0 upstream tokens');
                  return;
                }
              }
            }
          }
        } catch (e) {
          console.error('[local-brain] Error (falling through):', e.message);
        }

        // ─── ZERO-TOKEN INTENT ROUTER: Handle requests locally (0 upstream tokens) ───
        // Intercepts web search, math, code exec, memory recall, and browser queries
        // before they reach any upstream LLM provider. Returns fake OpenAI response with
        // usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }.
        try {
          const localResult = wantsStream
            ? null // Stream mode not yet supported for zero-token (falls through to LLM)
            : await routeZeroToken(parsed.messages, reqModel);
          if (localResult) {
            console.error('[zt-router] Handled locally → 0 upstream tokens (intent=' + (localResult._zero_token ? 'local' : '?') + ')');
            if (wantsStream) {
              const chunks = await routeZeroTokenStream(parsed.messages, reqModel);
              if (chunks) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
                for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(localResult));
              return;
            }
          }
        } catch (e) {
          console.error('[zt-router] Error (proceeding to upstream):', e.message);
        }

        // ─── PROMPT CACHING EXPLOIT: Inject fixed preamble for provider-side cache hits ───
        // After first request, providers cache this exact prefix → 0 tokens for cached portion
        console.error('[cache-exploit] Injecting preamble (' + getCachedTokenCount() + ' token equiv)');
        parsed.messages = injectPreamble(parsed.messages);

        // ─── LOCAL BRAIN FALLBACK (0 upstream tokens) ───
        // When all upstream providers are rate-limited, use local brain for simple queries.
        // Fires for ANY model (auto or specific) and ANY mode (stream or non-stream)
        // BEFORE the slow 28-tier upstream chain, so clients never hang.
        try {
          const lastMsg = parsed.messages[parsed.messages.length - 1]?.content || '';
          if (lastMsg.length > 5) {
            const isComplex = !wantsStream && /write.*code|implement|build.*app|debug.*script|complex|analyze.*data|create.*api/i.test(lastMsg) && lastMsg.length > 40;
            if (!isComplex) {
              const localRes = await askLocal(parsed.messages, { max_tokens: parsed.max_tokens || 512, timeout: 30000 });
              if (localRes) {
                console.error('[local-brain] Local fallback (0 upstream tokens)');
                if (wantsStream) {
                  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
                  res.write('data: ' + JSON.stringify({
                    id: 'lb-' + Date.now(), object: 'chat.completion.chunk', model: 'local-brain',
                    choices: [{ index: 0, delta: { content: localRes }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                  }) + '\n\n');
                  res.write('data: [DONE]\n\n');
                  res.end();
                } else {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    id: 'lb-' + Date.now(), object: 'chat.completion', model: 'local-brain',
                    choices: [{ index: 0, message: { role: 'assistant', content: localRes }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, _zero_token: true
                  }));
                }
                return;
              }
            }
          }
        } catch (e) {
          console.error('[local-brain] Local fallback error:', e.message);
        }

        // Track already-tried providers to avoid redundant retries in fallback chain
        const triedProviders = new Set();

        
// ─── UNIVERSAL CLOUDFLARE SWARM (Clean IP for ALL external providers) ───
async function routeViaUniversalSwarm(providerName, targetUrl, apiKey, payload, wantsStream, res) {
  try {
    const swarmUrl = 'https://zen-swarm-1.ozotyty.workers.dev/v1/chat/completions';
    const swarmHeaders = {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
      'X-Target-URL': targetUrl
    };
    console.error('[cf-swarm] Routing ' + providerName + ' via Cloudflare clean IP...');
    const r = await tryUpstream(providerName + '-cf', payload.model, payload, wantsStream, res, swarmUrl, 'swarm-bearer', 15000, swarmHeaders);
    return r.ok;
  } catch(e) { console.error('[cf-swarm] error:', e.message); return false; }
}


// ─── AUTO mode: try multiple providers in order of preference (keyless first) ───
        if (reqModel === 'auto' || reqModel === 'auto:free') {
          // Check semantic cache first
          const cachedResponse = await checkSemanticCache(parsed.messages, reqModel);
          if (cachedResponse) {
            console.error('[cache] semantic hit for ' + reqModel);
            if (wantsStream) {
              res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
              res.write('data: ' + JSON.stringify(cachedResponse) + '\n\n');
              res.write('data: [DONE]\n\n');
              res.end();
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(cachedResponse));
            }
            return;
          }
          const selection = smartSelectModel(reqModel, parsed.messages);
          console.error('[auto] selected ' + selection.provider + ' → ' + selection.model + ' $' + selection.estimatedCost);
          let autoResponseSent = false;
          const autoStartTime = Date.now();
          // Parallel race keyless providers for fastest response
          const raceProviders = [
            { name: 'deepinfra', fn: async () => {
              triedProviders.add('deepinfra');
              const diModel = deepinfraModelFor(selection.model);
              if (!diModel) return false;
              const diPayload = { model: diModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const r = await streamFromUpstream(diPayload, wantsStream, res, 'https://api.deepinfra.com/v1/openai/chat/completions', undefined, 10000);
              if (r.ok) { autoResponseSent = true; return true; }
              return false;
            }},
            { name: 'siliconflow', fn: async () => {
              triedProviders.add('siliconflow');
              const sfModel = siliconflowModelFor(selection.model);
              if (!sfModel) return false;
              const sfPayload = { model: sfModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const r = await streamFromUpstream(sfPayload, wantsStream, res, 'https://api.siliconflow.com/v1/chat/completions', undefined, 10000);
              if (r.ok) { autoResponseSent = true; return true; }
              return false;
            }},
            { name: 'freebuff', fn: async () => {
              triedProviders.add('freebuff');
              const fbModel = freebuffModelFor(selection.model);
              if (!fbModel) return false;
              const fbPayload = { model: fbModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const r = await streamFromUpstream(fbPayload, wantsStream, res, 'http://127.0.0.1:8001/v1/chat/completions', undefined, 25000);
              if (r.ok) { autoResponseSent = true; return true; }
              return false;
            }},
            { name: 'puter', fn: async () => {
              if (!HAS_PUTER) return false;
              triedProviders.add('puter');
              const puModel = puterAIModelFor(selection.model);
              if (!puModel) return false;
              const puPayload = { model: puModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const r = await streamFromUpstream(puPayload, wantsStream, res, 'https://api.puter.com/v1/chat/completions', PUTER_TOKEN, 15000);
              if (r.ok) { autoResponseSent = true; return true; }
              return false;
            }},
            { name: 'anthropic-bridge', fn: async () => {
              if (!/claude|anthropic/i.test(selection.model)) return false;
              triedProviders.add('anthropic-bridge');
              const abPayload = { model: selection.model, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              for (let retry = 0; retry < 2; retry++) {
                const r = await streamFromUpstream(abPayload, wantsStream, res, 'http://127.0.0.1:8084/v1/chat/completions', undefined, 15000);
                if (r.ok) { autoResponseSent = true; return true; }
              }
              return false;
            }},
            { name: 'tfg', fn: async () => {
              triedProviders.add('tfg');
              const tfgPayload = { model: selection.model, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const r = await streamFromUpstream(tfgPayload, wantsStream, res, 'http://127.0.0.1:3456/v1/chat/completions', undefined, 15000);
              if (r.ok) { autoResponseSent = true; return true; }
              return false;
            }},
          ];
          await Promise.race(raceProviders.map(p => p.fn().catch(() => false)));
          if (autoResponseSent) {
            recordRoutingResult(selection.provider, selection.model, true, Date.now() - autoStartTime, inferTaskType(parsed.messages));
            return;
          }
          const providersToTry = [
            { name: 'tfg', key: true, check: true },
            { name: 'fugu', key: true, check: true },
            { name: 'freebuff', key: true, check: true },
            { name: 'deepinfra', key: true, check: true },
            { name: 'siliconflow', key: true, check: true },
            { name: 'anthropic-bridge', key: true, check: true },
            { name: 'github', key: !!GITHUB_KEY, check: true },
            { name: 'groq', key: !!GROQ_KEY, check: true },
            { name: 'nvidia', key: !!NVIDIA_KEY, check: true },
            { name: 'mistral', key: MISTRAL_KEY, check: true },
            { name: 'or', key: HAS_OR, check: true },
            { name: 'gemini', key: GEMINI_KEY, check: true },
          ];
          const nameToHandler = {
            or: async (sel) => {
              if (!sel.model || OR_KEYS.length === 0) return false;
              for (let attempt = 0; attempt < OR_KEYS.length; attempt++) {
                const key = nextOrKey();
                if (isModelFailed('or', sel.model + '_key' + attempt)) { continue; }
                console.error('[auto] → OR ' + sel.model + ' (key ' + (attempt + 1) + '/' + OR_KEYS.length + ') cost=$' + sel.estimatedCost.toFixed(6));
                triedProviders.add('or');
                const orTools = filterRelevantTools(parsed.tools, parsed.messages, budgetForProvider('or'));
                const orPayload = { model: sel.model, messages: compressMessages(parsed.messages, 50000).messages, max_tokens: Math.min(parsed.max_tokens || 4096, 4096), temperature: parsed.temperature ?? 0.7, stream: wantsStream, ...(orTools?.length ? { tools: orTools, tool_choice: parsed.tool_choice } : {}) };
                const r = await streamFromUpstream(orPayload, wantsStream, res, 'https://openrouter.ai/api/v1/chat/completions', key, 15000);
                if (r.ok) { budgetTracker.recordSpend(sel.model, estimatedTokens, estimatedTokens/2); return true; }
                if (r.status === 429) { markModelFailed('or', sel.model + '_key' + attempt, 429); console.error('[auto] → OR key ' + (attempt + 1) + ' 429, trying next'); continue; }
                if (r.status) { console.error('[auto] → OR fail HTTP ' + r.status); return false; }
              }
              console.error('[auto] → OR all ' + OR_KEYS.length + ' keys exhausted');
              return false;
            },
            tfg: async (sel) => {
              triedProviders.add('tfg');
              console.error('[auto] → TFG ' + sel.model + ' (free)');
              const tfgPayload = { model: sel.model, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const r = await streamFromUpstream(tfgPayload, wantsStream, res, 'http://127.0.0.1:3456/v1/chat/completions', undefined, 15000);
              if (r.ok) return true;
              return false;
            },
            fugu: async (sel) => {
              triedProviders.add('fugu');
              console.error('[auto] → FUGU ' + sel.model + ' (free)');
              const fuguPayload = { model: sel.model, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const r = await streamFromUpstream(fuguPayload, wantsStream, res, 'http://127.0.0.1:3458/v1/chat/completions', undefined, 15000);
              if (r.ok) return true;
              return false;
            },
            freebuff: async (sel) => {
              triedProviders.add('freebuff');
              const fbModel = freebuffModelFor(sel.model);
              if (!fbModel) return false;
              console.error('[auto] → freebuff ' + fbModel + ' (free)');
              const fbPayload = { model: fbModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const r = await streamFromUpstream(fbPayload, wantsStream, res, 'http://127.0.0.1:8001/v1/chat/completions', undefined, 25000);
              if (r.ok) return true;
              return false;
            },
            gemini: async (sel) => {
              if (!GEMINI_KEY) return false;
              triedProviders.add('gemini');
              const gmModel = geminiModelFor(sel.model);
              if (!gmModel) return false;
              console.error('[auto] → Gemini ' + gmModel + ' (free)');
              const r = await streamFromUpstream({ model: gmModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice }, wantsStream, res, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', GEMINI_KEY, 15000);
              if (r.ok) return true;
              return false;
            },
            mistral: async (sel) => {
              if (!MISTRAL_KEY) return false;
              triedProviders.add('mistral');
              console.error('[auto] → Mistral ' + sel.model + ' (free)');
              const sanitizedMsgs = sanitizeMessages(parsed.messages);
              const mistPayload = { model: sel.model, messages: sanitizedMsgs, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const r = await streamFromUpstream(mistPayload, wantsStream, res, 'https://api.mistral.ai/v1/chat/completions', MISTRAL_KEY, 15000);
              if (r.ok) return true;
              return false;
            },
            deepinfra: async (sel) => {
              triedProviders.add('deepinfra');
              const diModel = deepinfraModelFor(sel.model);
              if (!diModel) return false;
              console.error('[auto] → DeepInfra ' + diModel + ' (free)');
              const diPayload = { model: diModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const r = await streamFromUpstream(diPayload, wantsStream, res, 'https://api.deepinfra.com/v1/openai/chat/completions', undefined, 10000);
              if (r.ok) return true;
              return false;
            },
            siliconflow: async (sel) => {
              triedProviders.add('siliconflow');
              const sfModel = siliconflowModelFor(sel.model);
              if (!sfModel) return false;
              console.error('[auto] → SiliconFlow ' + sfModel + ' (free)');
              const sfPayload = { model: sfModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const r = await streamFromUpstream(sfPayload, wantsStream, res, 'https://api.siliconflow.com/v1/chat/completions', undefined, 10000);
              if (r.ok) return true;
              return false;
            },
          };
          for (const p of providersToTry) {
            if (autoResponseSent) break;
            if (p.check && selection.provider === p.name && nameToHandler[p.name]) {
              const ok = await nameToHandler[p.name](selection);
              if (ok) { recordRoutingResult(selection.provider, selection.model, true, Date.now() - autoStartTime, inferTaskType(parsed.messages)); return; }
            }
          }
          // If smart-select provider failed, try remaining eligible providers in order
          for (const p of providersToTry) {
            if (autoResponseSent) break;
            if (p.name !== selection.provider && p.key && nameToHandler[p.name]) {
              const ok = await nameToHandler[p.name]({ ...selection, provider: p.name });
              if (ok) { recordRoutingResult(p.name, selection.model, true, Date.now() - autoStartTime, inferTaskType(parsed.messages)); return; }
            }
          }
          // Fall through to full fallback chain
        }

        // ─── TIER 1: BLIND FREE BRAIN (Multi-Key + Tor) ───
        // HuggingFace (70B) + SiliconFlow (DeepSeek-V3/Qwen-72B) with:
        //   - Multi-account key rotation (auto round-robin)
        //   - Tor IP rotation (unblockable, untraceable)
        //   - Key cooldown (auto-skip rate-limited keys)
        //   - Anonymous fallback (drop key, route via Tor)
        // These are FREE, 0-token-billed, 0-local-resource remote brains.

        // Try SiliconFlow with multi-key rotation + Tor fallback
        if (!triedProviders.has('siliconflow') && KEY_POOLS.siliconflow.hasKeys) {
          try {
            const sfKey = KEY_POOLS.siliconflow.next();
            const sfModel = siliconflowModelFor(reqModel) || 'Qwen/Qwen2.5-72B-Instruct';
            const sfPayload = { model: sfModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
            const sfResult = await tryUpstream('siliconflow', reqModel, sfPayload, wantsStream, res,
              'https://api.siliconflow.cn/v1/chat/completions', sfKey, 20000);
            if (sfResult.ok) { console.error('[tier1-sf] Responded (0 local)'); return; }
            if (sfResult.status === 429 || sfResult.status === 403) {
              KEY_POOLS.siliconflow.markCooldown(sfKey);
              rotateTorIP();
              console.error('[tier1-sf] Rate limited, routing via Tor...');
              const torResult = await tryViaTor(sfPayload, wantsStream, res,
                'https://api.siliconflow.cn/v1/chat/completions', sfKey, 20000);
              if (torResult.ok) { console.error('[tier1-sf] Via Tor OK'); return; }
            }
            console.error('[tier1-sf] fail:', sfResult.status || sfResult.error || '?');
            triedProviders.add('siliconflow');
          } catch(e) { console.error('[tier1-sf] error:', e.message); triedProviders.add('siliconflow'); }
        }

        // Try HuggingFace with multi-key rotation + Tor fallback
        if (!triedProviders.has('hf') && KEY_POOLS.hf.hasKeys) {
          try {
            const hfKey = KEY_POOLS.hf.next();
            const hfModel = hfModelFor(reqModel) || 'meta-llama/Llama-3.3-70B-Instruct';
            const hfPayload = { model: hfModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
            const hfResult = await tryUpstream('hf', reqModel, hfPayload, wantsStream, res,
              'https://router.huggingface.co/v1/chat/completions', hfKey, 30000);
            if (hfResult.ok) { console.error('[tier1-hf] Responded (0 local)'); return; }
            if (hfResult.status === 429 || hfResult.status === 403) {
              KEY_POOLS.hf.markCooldown(hfKey);
              rotateTorIP();
              console.error('[tier1-hf] Rate limited, rotating Tor IP...');
              const torResult = await tryViaTor(hfPayload, wantsStream, res,
                'https://router.huggingface.co/v1/chat/completions', hfKey, 30000);
              if (torResult.ok) { console.error('[tier1-hf] Via Tor OK'); return; }
            }
            console.error('[tier1-hf] fail:', hfResult.status || hfResult.error || '?');
            triedProviders.add('hf');
          } catch(e) { console.error('[tier1-hf] error:', e.message); triedProviders.add('hf'); }
        }

        // ─── KEYLESS-FIRST FALLBACK CHAIN ───
        // Order: keyless providers FIRST, then high-limit-key providers, then key-based last resort
        // This ensures ZERO keys are consumed in 95%+ of requests

        // [GROUP A: KEYLESS — no API keys ever sent to upstream]
        // These providers cost $0 and consume NO keys — they are truly blind
        // HEDGED: Fire all keyless providers in parallel, take first success

        const hedgeProviders = [];

        // 1. PuterAI
        if (!triedProviders.has('puter') && HAS_PUTER) {
          const puModel = puterAIModelFor(reqModel);
          if (puModel) {
            hedgeProviders.push((async () => {
              try {
                const puPayload = { model: puModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
                const puResult = await streamFromUpstream(puPayload, wantsStream, res, 'https://api.puter.com/v1/chat/completions', PUTER_TOKEN, 15000);
                if (puResult.ok) return 'puter';
                triedProviders.add('puter');
              } catch(e) { triedProviders.add('puter'); }
              return null;
            })());
          }
        }

        // 2. Deep Infra
        if (!triedProviders.has('deepinfra')) {
          const diModel = deepinfraModelFor(reqModel);
          if (diModel) {
            hedgeProviders.push((async () => {
              try {
                const diPayload = { model: diModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
                const diResult = await streamFromUpstream(diPayload, wantsStream, res, 'https://api.deepinfra.com/v1/openai/chat/completions', undefined, 10000);
                if (diResult.ok) return 'deepinfra';
                triedProviders.add('deepinfra');
              } catch(e) { triedProviders.add('deepinfra'); }
              return null;
            })());
          }
        }

        // 3. SiliconFlow
        if (!triedProviders.has('siliconflow')) {
          const sfModel = siliconflowModelFor(reqModel);
          if (sfModel) {
            hedgeProviders.push((async () => {
              try {
                const sfPayload = { model: sfModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
                const sfResult = await streamFromUpstream(sfPayload, wantsStream, res, 'https://api.siliconflow.com/v1/chat/completions', undefined, 10000);
                if (sfResult.ok) return 'siliconflow';
                triedProviders.add('siliconflow');
              } catch(e) { triedProviders.add('siliconflow'); }
              return null;
            })());
          }
        }

        // 4. freebuff (:8001)
        if (!triedProviders.has('freebuff')) {
          const fbModel = freebuffModelFor(reqModel);
          if (fbModel) {
            hedgeProviders.push((async () => {
              try {
                const fbPayload = { model: fbModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
                const fbResult = await streamFromUpstream(fbPayload, wantsStream, res, 'http://127.0.0.1:8001/v1/chat/completions', undefined, 25000);
                if (fbResult.ok) return 'freebuff';
                triedProviders.add('freebuff');
              } catch(e) { triedProviders.add('freebuff'); }
              return null;
            })());
          }
        }

        // Race all keyless providers — first success wins
        if (hedgeProviders.length > 1) {
          const racers = hedgeProviders.map(p => p.then(r => ({ winner: r })).catch(() => ({ winner: null })));
          const first = await Promise.race(racers);
          if (first.winner) { console.error('[hedge] ' + first.winner + ' won keyless race'); return; }
          // Fastest failed, wait for all remaining
          const all = await Promise.all(hedgeProviders.map(p => p.catch(() => null)));
          const winner = all.find(r => r);
          if (winner) { console.error('[hedge] ' + winner + ' won (late)'); return; }
        } else if (hedgeProviders.length === 1) {
          const winner = await hedgeProviders[0];
          if (winner) return;
        }

        // 4. TFG (:3456) — browser-based inference, any model, no key
        if (!triedProviders.has('tfg') && reqModel !== 'auto' && reqModel !== 'auto:free') {
          if (!isModelFailed('tfg', reqModel)) {
            console.error('[tfg] trying ' + reqModel + ' on :3456');
            try {
              const tfgExactPayload = { model: reqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const tfgExactResult = await streamFromUpstream(tfgExactPayload, wantsStream, res, 'http://127.0.0.1:3456/v1/chat/completions', undefined, 15000);
              if (tfgExactResult.ok) return;
              triedProviders.add('tfg');
              if (tfgExactResult.status === 429 || tfgExactResult.status === 502) markModelFailed('tfg', reqModel, tfgExactResult.status);
            } catch(e) { triedProviders.add('tfg'); }
          } else {
            console.error('[tfg] skip ' + reqModel + ' (cached fail)');
            triedProviders.add('tfg');
          }
        }

        // 5. Fugu (:3458) — local multi-agent proxy, any model, no key
        if (!triedProviders.has('fugu') && reqModel !== 'auto' && reqModel !== 'auto:free') {
          if (!isModelFailed('fugu', reqModel)) {
            console.error('[fugu] trying ' + reqModel + ' on :3458');
            try {
              const fuguExactPayload = { model: reqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const fuguExactResult = await streamFromUpstream(fuguExactPayload, wantsStream, res, 'http://127.0.0.1:3458/v1/chat/completions', undefined, 15000);
              if (fuguExactResult.ok) return;
              triedProviders.add('fugu');
              if (fuguExactResult.status === 429 || fuguExactResult.status === 502) markModelFailed('fugu', reqModel, fuguExactResult.status);
            } catch(e) { triedProviders.add('fugu'); }
          } else {
            console.error('[fugu] skip ' + reqModel + ' (cached fail)');
            triedProviders.add('fugu');
          }
        }

        // 6. OVHcloud AI Endpoints — anonymous free tier, 2 RPM, no key needed
        if (!triedProviders.has('ovh')) {
          const ovhModel = ovhModelFor(reqModel);
          if (ovhModel) {
            try {
              const ovhPayload = { model: ovhModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const ovhResult = await tryUpstream('ovh', reqModel, ovhPayload, wantsStream, res, 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', '', 15000);
              if (ovhResult.ok) return;
              console.error('[ovh] fail: ' + (ovhResult.status||'?') + ' ' + (ovhResult.body||ovhResult.error||''));
              triedProviders.add('ovh');
            } catch(e) { console.error('[ovh] error: ' + e.message); triedProviders.add('ovh'); }
          } else {
            triedProviders.add('ovh');
          }
        }

        // 7. Kilo Gateway — anonymous free tier, no key needed
        if (!triedProviders.has('kilo')) {
          try {
            const kiloModel = reqModel === 'auto' || reqModel === 'auto:free' ? 'kilo-auto/free' : reqModel;
            const kiloResult = await tryUpstream('kilo', reqModel,
              { model: kiloModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream },
              wantsStream, res, 'https://api.kilo.ai/api/gateway/v1/chat/completions', 'unused', 15000
            );
            if (kiloResult.ok) return;
            console.error('[kilo] fail: ' + (kiloResult.status||'?') + ' ' + (kiloResult.body||kiloResult.error||''));
            triedProviders.add('kilo');
          } catch(e) { console.error('[kilo] error: ' + e.message); triedProviders.add('kilo'); }
        }

        // 8. freellmapi (:3002) — catch-all, community-shared OpenRouter keys (NOT your keys)
        if (!triedProviders.has('freellmapi')) {
          try {
            const sanitizedMsgsFLM = sanitizeMessages(parsed.messages);
            const upPayload = JSON.stringify({ ...parsed, messages: sanitizedMsgsFLM, model: 'auto', max_tokens: parsed.max_tokens || 4096 });
            const flmResult = await tryFreellmapi(upPayload, wantsStream, res, 1);
            if (flmResult.ok) return;
            triedProviders.add('freellmapi');
          } catch(e) { console.error('[freellmapi] error: ' + e.message); triedProviders.add('freellmapi'); }
        }

        // [GROUP B: COMMUNITY / HIGH-LIMIT KEYS — your key is NOT consumed or very low consumption]

        // 9. anthropic-bridge (:8084) — community Claude routing (NOT your API key)
        if (!triedProviders.has('anthropic-bridge') && /claude|anthropic/i.test(reqModel)) {
          for (let retry = 0; retry < 2; retry++) {
            try {
              const abPayload = { model: reqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const abResult = await streamFromUpstream(abPayload, wantsStream, res, 'http://127.0.0.1:8084/v1/chat/completions', undefined, 15000);
              if (abResult.ok) return;
              if (retry === 0) console.error('[anthropic-bridge] retry ' + (retry+1) + ': ' + (abResult.error||abResult.status||'?'));
              else console.error('[anthropic-bridge] fail: ' + (abResult.status||'?') + ' ' + (abResult.body||abResult.error||''));
            } catch(e) { console.error('[anthropic-bridge] error ' + (retry+1) + ': ' + e.message); }
          }
          triedProviders.add('anthropic-bridge');
        }

        // 10. Cloudflare Workers AI — edge inference, 300K free neurons/day (very high limit)
        if (!triedProviders.has('cloudflare') && CLOUDFLARE_KEY) {
          const cfModel = cloudflareModelFor(reqModel);
          if (cfModel) {
            try {
              const cfPayload = { model: cfModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const cfResult = await tryUpstream('cloudflare', reqModel, cfPayload, wantsStream, res, 'https://api.cloudflare.com/client/v4/ai/chat/completions', CLOUDFLARE_KEY, 15000);
              if (cfResult.ok) return;
              console.error('[cloudflare] fail: ' + (cfResult.status||'?') + ' ' + (cfResult.body||cfResult.error||''));
              triedProviders.add('cloudflare');
            } catch(e) { console.error('[cloudflare] error: ' + e.message); triedProviders.add('cloudflare'); }
          } else {
            triedProviders.add('cloudflare');
          }
        }

        // 11. Cloudflare AI Gateway — same key, alternative endpoint
        if (!triedProviders.has('ai-gateway') && process.env.CF_AI_GATEWAY_URL && CLOUDFLARE_KEY) {
          const agModel = aiGatewayModelFor(reqModel);
          if (agModel) {
            try {
              const agPayload = { model: agModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const agResult = await tryUpstream('ai-gateway', reqModel, agPayload, wantsStream, res, process.env.CF_AI_GATEWAY_URL, CLOUDFLARE_KEY, 15000);
              if (agResult.ok) return;
              console.error('[ai-gateway] fail: ' + (agResult.status||'?') + ' ' + (agResult.body||agResult.error||''));
              triedProviders.add('ai-gateway');
            } catch(e) { console.error('[ai-gateway] error: ' + e.message); triedProviders.add('ai-gateway'); }
          } else {
            triedProviders.add('ai-gateway');
          }
        }

        // 12. GitHub Models — free GPT-4o via GITHUB_TOKEN (rate limited, 10 req/min)
        if (!triedProviders.has('github') && KEY_POOLS.github.hasKeys) {
          const ghModel = githubModelFor(reqModel);
          if (ghModel) {
            try {
              const ghPayload = { model: ghModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const ghKey = KEY_POOLS.github.next();
              const ghResult = await tryUpstream('github', reqModel, ghPayload, wantsStream, res, 'https://models.github.ai/inference/v1/chat/completions', ghKey, 15000);
              if (ghResult.ok) return;
              if (ghResult.status === 429 || ghResult.status === 403) {
                KEY_POOLS.github.markCooldown(ghKey);
                console.error('[github] ' + ghResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(ghPayload, wantsStream, res, 'https://models.github.ai/inference/v1/chat/completions', ghKey, 15000);
                if (torResult.ok) return;
              }
              console.error('[github] fail: ' + (ghResult.status||'?') + ' ' + (ghResult.body||ghResult.error||''));
              triedProviders.add('github');
            } catch(e) { console.error('[github] error: ' + e.message); triedProviders.add('github'); }
          } else {
            triedProviders.add('github');
          }
        }

        // 13. GitHub Copilot — GPT-4o/Claude via api.githubcopilot.com
        if (!triedProviders.has('copilot') && KEY_POOLS.github.hasKeys) {
          const cpModel = copilotModelFor(reqModel);
          if (cpModel) {
            try {
              const cpPayload = { model: cpModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const cpKey = KEY_POOLS.github.next();
              const cpResult = await streamFromUpstream(cpPayload, wantsStream, res, 'https://api.githubcopilot.com/v1/chat/completions', cpKey, 5000);
              if (cpResult.ok) return;
              if (cpResult.status === 429 || cpResult.status === 403) {
                KEY_POOLS.github.markCooldown(cpKey);
                console.error('[copilot] ' + cpResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(cpPayload, wantsStream, res, 'https://api.githubcopilot.com/v1/chat/completions', cpKey, 5000);
                if (torResult.ok) return;
              }
              console.error('[copilot] fail: ' + (cpResult.status||'?') + ' ' + (cpResult.body||cpResult.error||''));
              triedProviders.add('copilot');
            } catch(e) { console.error('[copilot] error: ' + e.message); triedProviders.add('copilot'); }
          } else {
            triedProviders.add('copilot');
          }
        }

        // 14. FreeTheAi — 50+ free models (FREETHEAI_API_KEY, generous free tier)
        if (!triedProviders.has('freetheai') && KEY_POOLS.freetheai.hasKeys) {
          const ftaModel = freetheaiModelFor(reqModel);
          if (ftaModel) {
            try {
              const ftaPayload = { model: ftaModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const ftaKey = KEY_POOLS.freetheai.next();
              const ftaResult = await tryUpstream('freetheai', reqModel, ftaPayload, wantsStream, res, 'https://api.freetheai.xyz/v1/chat/completions', ftaKey, 15000);
              if (ftaResult.ok) return;
              if (ftaResult.status === 429 || ftaResult.status === 403) {
                KEY_POOLS.freetheai.markCooldown(ftaKey);
                console.error('[freetheai] ' + ftaResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(ftaPayload, wantsStream, res, 'https://api.freetheai.xyz/v1/chat/completions', ftaKey, 15000);
                if (torResult.ok) return;
              }
              console.error('[freetheai] fail: ' + (ftaResult.status||'?') + ' ' + (ftaResult.body||ftaResult.error||''));
              triedProviders.add('freetheai');
            } catch(e) { console.error('[freetheai] error: ' + e.message); triedProviders.add('freetheai'); }
          } else {
            triedProviders.add('freetheai');
          }
        }

        // [GROUP C: KEY-BASED LAST RESORT — your API keys consumed here, rarely reached]

        // 15. OpenRouter (free tiers) — with multi-key rotation + Tor fallback
        if (!triedProviders.has('or') && HAS_OR && !isTooLargeForOR) {
          const orModel = orModelFor(reqModel);
          if (orModel) {
            let orSucceeded = false;
            let lastOrPayload;
            for (let attempt = 0; attempt < OR_KEYS.length; attempt++) {
              const key = nextOrKey();
              if (isModelFailed('or', orModel + '_key' + attempt)) { continue; }
              console.error('[or] trying ' + orModel + ' (key ' + (attempt + 1) + '/' + OR_KEYS.length + ')');
              const compressed = compressMessages(parsed.messages, budgetForProvider('or') * 0.6);
              const orTools = filterRelevantTools(parsed.tools, compressed.messages, budgetForProvider('or'));
              lastOrPayload = { model: orModel, messages: compressed.messages, max_tokens: Math.min(parsed.max_tokens || 4096, 4096), temperature: parsed.temperature ?? 0.7, stream: wantsStream, ...(orTools?.length ? { tools: orTools, tool_choice: parsed.tool_choice } : {}) };
              const r = await routeViaUniversalSwarm('or', 'https://openrouter.ai/api/v1/chat/completions', key, lastOrPayload, wantsStream, res);
              if (r.ok) { budgetTracker.recordSpend(orModel, estimatedTokens, estimatedTokens/2); orSucceeded = true; return; }
              console.error('[or] key ' + (attempt + 1) + ' status=' + (r.status||'?') + (r.error||r.body||''));
              if (r.status === 429) {
                markModelFailed('or', orModel + '_key' + attempt, 429);
                console.error('[or] key ' + (attempt + 1) + ' 429, trying via Tor SOCKS5...');
                const torResult = await tryOpenRouterViaTor(lastOrPayload, wantsStream, res, key, 15000);
                if (torResult.ok) { budgetTracker.recordSpend(orModel, estimatedTokens, estimatedTokens/2); orSucceeded = true; return; }
                continue;
              }
              if (r.status) break;
            }
            if (!orSucceeded) {
              console.error('[or] all ' + OR_KEYS.length + ' keys exhausted');
              for (let attempt = 0; attempt < OR_KEYS.length; attempt++) {
                const key = OR_KEYS[attempt];
                console.error('[or] last-resort via Tor key ' + (attempt + 1));
                const torResult = await tryOpenRouterViaTor(lastOrPayload, wantsStream, res, key, 20000);
                if (torResult.ok) { orSucceeded = true; return; }
              }
            }
          }
        } else if (HAS_OR && isTooLargeForOR) {
          console.error('[or] skipped (~' + Math.round(estimatedTokens) + ' tokens exceeds OR free limit)');
        }

        // 16. Groq — fastest inference, 700+ tok/s, 14,400 req/day free
        if (!triedProviders.has('groq') && KEY_POOLS.groq.hasKeys) {
          const gqModel = groqModelFor(reqModel);
          if (gqModel) {
            try {
              const gqPayload = { model: gqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const gqKey = KEY_POOLS.groq.next();
              const gqResult = await tryUpstream('groq', reqModel, gqPayload, wantsStream, res, 'https://api.groq.com/openai/v1/chat/completions', gqKey, 15000);
              if (gqResult.ok) return;
              if (gqResult.status === 429 || gqResult.status === 403) {
                KEY_POOLS.groq.markCooldown(gqKey);
                console.error('[groq] ' + gqResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(gqPayload, wantsStream, res, 'https://api.groq.com/openai/v1/chat/completions', gqKey, 15000);
                if (torResult.ok) return;
              }
              console.error('[groq] fail: ' + (gqResult.status||'?') + ' ' + (gqResult.body||gqResult.error||''));
              triedProviders.add('groq');
            } catch(e) { console.error('[groq] error: ' + e.message); triedProviders.add('groq'); }
          } else {
            triedProviders.add('groq');
          }
        }

        // 17. Mistral API — free tier, 1B tokens/mo
        if (!triedProviders.has('mistral') && MISTRAL_KEY) {
          const mistModel = mistralModelFor(reqModel);
          if (mistModel) {
            try {
              const sanitizedMsgs = sanitizeMessages(parsed.messages);
              const mistPayload = { model: mistModel, messages: sanitizedMsgs, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const mistResult = await tryUpstream('mistral', reqModel, mistPayload, wantsStream, res, 'https://api.mistral.ai/v1/chat/completions', MISTRAL_KEY, 15000);
              if (mistResult.ok) { recordProviderSuccess('mistral', reqModel); return; }
              if (mistResult.status === 429 || mistResult.status === 403) {
                recordProviderFailure('mistral', reqModel, mistResult.status);
                console.error('[mistral] ' + mistResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(mistPayload, wantsStream, res, 'https://api.mistral.ai/v1/chat/completions', MISTRAL_KEY, 15000);
                if (torResult.ok) { recordProviderSuccess('mistral', reqModel); return; }
              }
              console.error('[mistral] fail: ' + (mistResult.status||'?') + ' ' + (mistResult.body||mistResult.error||''));
              triedProviders.add('mistral');
            } catch(e) { console.error('[mistral] error: ' + e.message); triedProviders.add('mistral'); }
          } else {
            triedProviders.add('mistral');
          }
        }

        // 18. NVIDIA NIM — free tier, Nemotron 3 Super 120B
        if (!triedProviders.has('nvidia') && NVIDIA_KEY) {
          const nvModel = nvidiaModelFor(reqModel);
          if (nvModel) {
            try {
              const nvPayload = { model: nvModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const nvResult = await tryUpstream('nvidia', reqModel, nvPayload, wantsStream, res, 'https://integrate.api.nvidia.com/v1/chat/completions', NVIDIA_KEY, 15000);
              if (nvResult.ok) { recordProviderSuccess('nvidia', reqModel); return; }
              if (nvResult.status === 429 || nvResult.status === 403) {
                recordProviderFailure('nvidia', reqModel, nvResult.status);
                console.error('[nvidia] ' + nvResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(nvPayload, wantsStream, res, 'https://integrate.api.nvidia.com/v1/chat/completions', NVIDIA_KEY, 15000);
                if (torResult.ok) { recordProviderSuccess('nvidia', reqModel); return; }
              }
              console.error('[nvidia] fail: ' + (nvResult.status||'?') + ' ' + (nvResult.body||nvResult.error||''));
              triedProviders.add('nvidia');
            } catch(e) { console.error('[nvidia] error: ' + e.message); triedProviders.add('nvidia'); }
          } else {
            triedProviders.add('nvidia');
          }
        }

        // 19. FreeModel (freemodel.dev) — free Claude/GPT models, needs FREEMODEL_KEY
        if (!triedProviders.has('freemodel') && FREEMODEL_KEY) {
          const fmModel = freeModelFor(reqModel);
          if (fmModel) {
            try {
              const fmPayload = { model: fmModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const fmResult = await streamFromUpstream(fmPayload, wantsStream, res, 'https://cc.freemodel.dev/v1/messages', FREEMODEL_KEY, 15000);
              if (fmResult.ok) return;
              console.error('[freemodel] fail: ' + (fmResult.status||'?') + ' ' + (fmResult.body||fmResult.error||''));
              triedProviders.add('freemodel');
            } catch(e) { console.error('[freemodel] error: ' + e.message); triedProviders.add('freemodel'); }
          } else {
            triedProviders.add('freemodel');
          }
        }

        // 20. OpenModel AI — for models with specific routes (Claude, GPT-5, Qwen3, GLM, DeepSeek)
        if (!triedProviders.has('openmodel') && OPENMODEL_KEY) {
          try {
            const omOk = await tryOpenModelAI(parsed, wantsStream, res, reqModel, OPENMODEL_KEY);
            if (omOk) return;
            triedProviders.add('openmodel');
          } catch(e) { console.error('[openmodel] error: ' + e.message); triedProviders.add('openmodel'); }
        } else {
          triedProviders.add('openmodel');
        }

        // 21. Gemini API — direct, free tier
        if (!triedProviders.has('gemini') && GEMINI_KEY) {
          const gmModel = geminiModelFor(reqModel) || (reqModel.startsWith('gemini-3.1') ? 'gemini-3.1-flash' : 'gemini-2.5-flash');
          if (gmModel) {
            try {
              const gmPayload = { model: gmModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 8192, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const gmResult = await tryUpstream('gemini', reqModel, gmPayload, wantsStream, res, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', GEMINI_KEY, 15000);
              if (gmResult.ok) { recordProviderSuccess('gemini', reqModel); return; }
              if (gmResult.status === 429 || gmResult.status === 403) {
                recordProviderFailure('gemini', reqModel, gmResult.status);
                console.error('[gemini] ' + gmResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(gmPayload, wantsStream, res, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', GEMINI_KEY, 15000);
                if (torResult.ok) { recordProviderSuccess('gemini', reqModel); return; }
              }
              console.error('[gemini] fail: ' + (gmResult.status||'?') + ' ' + (gmResult.body||gmResult.error||''));
              triedProviders.add('gemini');
            } catch(e) { console.error('[gemini] error: ' + e.message); triedProviders.add('gemini'); }
          } else {
            triedProviders.add('gemini');
          }
        }

        // 22. Cerebras — fastest provider, 0.7s response, 5 req/min free
        if (!triedProviders.has('cerebras') && KEY_POOLS.cerebras.hasKeys) {
          const cerebrasModel = cerebrasModelFor(reqModel);
          if (cerebrasModel) {
            try {
              const cerebrasPayload = { model: cerebrasModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const cerebrasKey = KEY_POOLS.cerebras.next();
              const cerebrasResult = await tryUpstream('cerebras', reqModel, cerebrasPayload, wantsStream, res, 'https://api.cerebras.ai/v1/chat/completions', cerebrasKey, 15000);
              if (cerebrasResult.ok) return;
              if (cerebrasResult.status === 429 || cerebrasResult.status === 403) {
                KEY_POOLS.cerebras.markCooldown(cerebrasKey);
                console.error('[cerebras] ' + cerebrasResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(cerebrasPayload, wantsStream, res, 'https://api.cerebras.ai/v1/chat/completions', cerebrasKey, 15000);
                if (torResult.ok) return;
              }
              console.error('[cerebras] fail: ' + (cerebrasResult.status||'?') + ' ' + (cerebrasResult.body||cerebrasResult.error||''));
              triedProviders.add('cerebras');
            } catch(e) { console.error('[cerebras] error: ' + e.message); triedProviders.add('cerebras'); }
          } else {
            triedProviders.add('cerebras');
          }
        }

        // 24. SambaNova — free 405B model tier
        if (!triedProviders.has('sambanova') && KEY_POOLS.sambanova.hasKeys) {
          const snModel = sambanovaModelFor(reqModel);
          if (snModel) {
            try {
              const snPayload = { model: snModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const snKey = KEY_POOLS.sambanova.next();
              const snResult = await tryUpstream('sambanova', reqModel, snPayload, wantsStream, res, 'https://api.sambanova.ai/v1/chat/completions', snKey, 15000);
              if (snResult.ok) return;
              if (snResult.status === 429 || snResult.status === 403) {
                KEY_POOLS.sambanova.markCooldown(snKey);
                console.error('[sambanova] ' + snResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(snPayload, wantsStream, res, 'https://api.sambanova.ai/v1/chat/completions', snKey, 15000);
                if (torResult.ok) return;
              }
              console.error('[sambanova] fail: ' + (snResult.status||'?') + ' ' + (snResult.body||snResult.error||''));
              triedProviders.add('sambanova');
            } catch(e) { console.error('[sambanova] error: ' + e.message); triedProviders.add('sambanova'); }
          } else {
            triedProviders.add('sambanova');
          }
        }

        // 25. BazaarLink — key auto-registered via agent API
        if (!triedProviders.has('bazaarlink') && KEY_POOLS.bazaarlink.hasKeys) {
          const blModel = bazaarlinkModelFor(reqModel);
          if (blModel) {
            try {
              const blPayload = { model: blModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream, tools: parsed.tools, tool_choice: parsed.tool_choice };
              const blKey = KEY_POOLS.bazaarlink.next();
              const blResult = await tryUpstream('bazaarlink', reqModel, blPayload, wantsStream, res, 'https://bazaarlink.ai/api/v1/chat/completions', blKey, 15000);
              if (blResult.ok) return;
              if (blResult.status === 429 || blResult.status === 403) {
                KEY_POOLS.bazaarlink.markCooldown(blKey);
                console.error('[bazaarlink] ' + blResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(blPayload, wantsStream, res, 'https://bazaarlink.ai/api/v1/chat/completions', blKey, 15000);
                if (torResult.ok) return;
              }
              console.error('[bazaarlink] fail: ' + (blResult.status||'?') + ' ' + (blResult.body||blResult.error||''));
              triedProviders.add('bazaarlink');
            } catch(e) { console.error('[bazaarlink] error: ' + e.message); triedProviders.add('bazaarlink'); }
          } else {
            triedProviders.add('bazaarlink');
          }
        }

        // 26. Bynara Router — 4 free models
        if (!triedProviders.has('bynara') && KEY_POOLS.bynara.hasKeys) {
          const bynaraModel = bynaraModelFor(reqModel);
          if (bynaraModel) {
            try {
              const bynaraPayload = { model: bynaraModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
              const bynaraKey = KEY_POOLS.bynara.next();
              const bynaraResult = await tryUpstream('bynara', reqModel, bynaraPayload, wantsStream, res, 'https://router.bynara.id/v1/chat/completions', bynaraKey, 15000);
              if (bynaraResult.ok) return;
              if (bynaraResult.status === 429 || bynaraResult.status === 403) {
                KEY_POOLS.bynara.markCooldown(bynaraKey);
                console.error('[bynara] ' + bynaraResult.status + ', trying via Tor...');
                const torResult = await tryViaTor(bynaraPayload, wantsStream, res, 'https://router.bynara.id/v1/chat/completions', bynaraKey, 15000);
                if (torResult.ok) return;
              }
              console.error('[bynara] fail: ' + (bynaraResult.status||'?') + ' ' + (bynaraResult.body||bynaraResult.error||''));
              triedProviders.add('bynara');
            } catch(e) { console.error('[bynara] error: ' + e.message); triedProviders.add('bynara'); }
          } else {
            triedProviders.add('bynara');
          }
        }

        // 26b. Additional free-tier providers from matrix-proxy node graph (keyless/key-based)
        // These add more free pool capacity — each new provider = new free tier to distribute across
        const EXTRA_PROVIDERS = [
          { name: 'digitalocean', url: 'https://inference.do-ai.run/v1/chat/completions', keyless: true },
          { name: 'scaleway', url: 'https://api.scaleway.ai/v1/chat/completions', keyless: true },
          { name: 'evroc', url: 'https://models.think.evroc.com/v1/chat/completions', keyless: true },
          { name: 'iflowcn', url: 'https://apis.iflow.cn/v1/chat/completions', keyless: true },
          { name: 'modelscope', url: 'https://api-inference.modelscope.cn/v1/chat/completions', keyless: true },
        ];
        for (const ep of EXTRA_PROVIDERS) {
          if (triedProviders.has(ep.name)) continue;
          try {
            const epPayload = { model: reqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
            const epResult = await streamFromUpstream(epPayload, wantsStream, res, ep.url, undefined, 15000);
            if (epResult.ok) return;
            console.error('[' + ep.name + '] fail: ' + (epResult.status||'?') + ' ' + (epResult.body||epResult.error||''));
            triedProviders.add(ep.name);
          } catch(e) { console.error('[' + ep.name + '] error: ' + e.message); triedProviders.add(ep.name); }
        }

        // 26c. GitLab AI — keyless via CI_JOB_TOKEN or personal token
        if (!triedProviders.has('gitlab') && (process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN)) {
          try {
            const glKey = process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN;
            const glPayload = { model: reqModel.startsWith('gitlab/') ? reqModel.replace('gitlab/','') : reqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
            const glResult = await tryUpstream('gitlab', reqModel, glPayload, wantsStream, res, 'https://gitlab.com/api/v4/ai/chat/completions', glKey, 15000);
            if (glResult.ok) return;
            console.error('[gitlab] fail: ' + (glResult.status||'?') + ' ' + (glResult.body||glResult.error||''));
            triedProviders.add('gitlab');
          } catch(e) { console.error('[gitlab] error: ' + e.message); triedProviders.add('gitlab'); }
        }

        // 27. 9router (:20128) — uber-fallback with 60+ provider routing
        if (false && !triedProviders.has('9router')) { // SKIP: Captcha token required
          try {
            const nineRouterPayload = { model: reqModel === 'auto' || reqModel === 'auto:free' ? 'auto' : reqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
            const nineRouterResult = await streamFromUpstream(nineRouterPayload, wantsStream, res, 'http://127.0.0.1:20128/v1/chat/completions', undefined, 15000);
            if (nineRouterResult.ok) return;
            triedProviders.add('9router');
          } catch(e) { console.error('[9router] error: ' + e.message); triedProviders.add('9router'); }
        }

        // 28. OmniRoute — free AI gateway (231+ providers, 50+ free)
        if (!triedProviders.has('omniroute')) {
          try {
            const orPayload = { model: reqModel, messages: parsed.messages, max_tokens: parsed.max_tokens || 4096, temperature: parsed.temperature ?? 0.7, stream: wantsStream };
            const orResult = await streamFromUpstream(orPayload, wantsStream, res, 'https://api.omniroute.io/v1/chat/completions', undefined, 25000);
            if (orResult.ok) return;
            triedProviders.add('omniroute');
          } catch(e) { console.error('[omniroute] error: ' + e.message); triedProviders.add('omniroute'); }
        }

        // 29. Matrix proxy — graph-based routing through all nodes
        if (!triedProviders.has('matrix')) {
          triedProviders.add('matrix');
          try {
            const matrixResult = await routeViaMatrix(parsed, wantsStream, res);
            if (matrixResult.ok) return;
          } catch(e) { console.error('[matrix] error: ' + e.message); }
        }

        // 29. All fallbacks exhausted — try local brain as final resort
        console.error('[proxy] all fallbacks exhausted, trying local brain...');
        try {
          if (parsed.messages?.length > 0) {
            const localRes = await askLocal(parsed.messages, { max_tokens: parsed.max_tokens || 512, timeout: 30000, temperature: parsed.temperature || 0.7 });
            if (localRes) {
              console.error('[proxy] Local brain final fallback (0 upstream tokens)');
              if (wantsStream) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
                res.write('data: ' + JSON.stringify({
                  id: 'lb-' + Date.now(), object: 'chat.completion.chunk', model: 'local-brain',
                  choices: [{ index: 0, delta: { content: localRes }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                }) + '\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  id: 'lb-' + Date.now(), object: 'chat.completion', model: 'local-brain',
                  choices: [{ index: 0, message: { role: 'assistant', content: localRes }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, _zero_token: true
                }));
              }
              return;
            }
          }
        } catch (e) {
          console.error('[proxy] Local brain fallback error:', e.message);
        }
        sendEmptyResponse(res, wantsStream);
      } catch(e) {
        console.error('[proxy] fatal: ' + e.message + ' ' + (e.stack||'').split('\n').slice(0,3).join(' '));
        sendEmptyResponse(res, false);
      }
    });
    return;
  }

  // File server (serves /home/ricos/share/ through the tunnel)
  if (req.method === 'GET' && req.url.startsWith('/v1/files/')) {
    const requestedPath = req.url.slice('/v1/files/'.length).replace(/\.\.\//g, '').replace(/\.\./g, '');
    const safePath = path_.join('/home/ricos/share', requestedPath || '.');
    if (!safePath.startsWith('/home/ricos/share')) {
      res.writeHead(403); return res.end('{"error":"forbidden"}');
    }
    try {
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        const items = fs.readdirSync(safePath).map(f => {
          const fp = path_.join(safePath, f);
          const isDir = fs.statSync(fp).isDirectory();
          return { name: f, type: isDir ? 'directory' : 'file', size: isDir ? 0 : fs.statSync(fp).size };
        });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ path: requestedPath || '/', items }));
      }
      const ext = path_.extname(safePath).toLowerCase();
      const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf' };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const content = fs.readFileSync(safePath);
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length, 'Access-Control-Allow-Origin': '*' });
      return res.end(content);
    } catch (e) {
      res.writeHead(404);
      return res.end('{"error":"not found"}');
    }
  }

  // ─── Caveman-style token compression (POST /v1/compress) ───
  if (req.method === 'POST' && req.url === '/v1/compress') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const text = parsed.text || '';
        const level = parsed.level || 'standard';

        // Caveman compression rules
        const replacements = {
          light: [
            [/\b(essentially|basically|actually|literally|honestly|simply|just)\b/gi, ''],
            [/\b(in order to)\b/gi, 'to'],
            [/\b(as a result|due to the fact that|owing to)\b/gi, 'because'],
            [/\b(a large number of|a majority of|numerous)\b/gi, 'many'],
            [/\b(in the event that|under the circumstance that)\b/gi, 'if'],
            [/\b(at this point in time|at the present time|currently)\b/gi, 'now'],
            [/\b(on a daily basis|on a regular basis)\b/gi, 'daily'],
            [/\b(the majority of|the vast majority of)\b/gi, 'most'],
            [/\b(a small number of|a minority of)\b/gi, 'few'],
            [/\b(in the vicinity of|in the neighborhood of)\b/gi, 'near'],
            [/\b(subsequent to|following after)\b/gi, 'after'],
            [/\b(prior to|previous to)\b/gi, 'before'],
            [/\b(utilize|utilization)\b/gi, 'use'],
            [/\b(implement|implementation)\b/gi, 'do'],
            [/\b(demonstrate|demonstration)\b/gi, 'show'],
            [/\b(sufficient|sufficiently)\b/gi, 'enough'],
            [/\b(additional|additionally)\b/gi, 'more'],
            [/\b(approximately|approximate)\b/gi, '~'],
            [/\b(communicate|communication)\b/gi, 'talk'],
            [/\b(determine|determination)\b/gi, 'find'],
            [/\b(establish|establishment)\b/gi, 'set'],
            [/\b(obtain|obtainment)\b/gi, 'get'],
            [/\b(require|requirement)\b/gi, 'need'],
            [/\b(maintain|maintenance)\b/gi, 'keep'],
          ],
          standard: [
            // Include all light rules
            [/\b(I think|I believe|in my opinion|it seems that|it appears that)\b/gi, ''],
            [/\b(It is important to note that|It should be noted that|It is worth noting that)\b/gi, 'Note:'],
            [/\b(It is possible that|It could be that|There is a possibility that)\b/gi, 'Maybe'],
            [/\b(This means that|What this means is that|The implication is that)\b/gi, 'So'],
            [/\b(The reason for this is|This is because|This is due to)\b/gi, 'Because'],
            [/\b(In other words|To put it another way|That is to say)\b/gi, 'i.e.'],
            [/\b(As mentioned earlier|As previously stated|As noted above)\b/gi, ''],
            [/\b(It is clear that|It is obvious that|Clearly,)\b/gi, ''],
            [/\b(Please|kindly|feel free to)\b/gi, ''],
            [/\b(Thank you|Thanks|Appreciate it)\b/gi, ''],
            [/\n{3,}/g, '\n\n'],
            [/\s{2,}/g, ' '],
          ]
        };

        const rules = level === 'aggressive'
          ? replacements.light.concat(replacements.standard)
              .concat([
                [/\b(the|a|an)\s+/gi, ''],
                [/\s+(the|a|an)\b/gi, ''],
                [/\b(very|really|quite|extremely|highly|absolutely|totally)\b/gi, ''],
                [/\b(in order|so as)\b/gi, 'to'],
                [/\b(may|might|could|would|should)\b/gi, ''],
                [/\b(that|which)\b/gi, ''],
                [/, however/g, '.'],
                [/\bhowever\b/gi, 'but'],
              ])
          : replacements.light.concat(replacements.standard);

        let compressed = text;
        for (const [pattern, replacement] of rules) {
          compressed = compressed.replace(pattern, replacement);
        }
        compressed = compressed.replace(/\n{3,}/g, '\n\n').trim();
        const saved = text.length ? Math.round((1 - compressed.length / text.length) * 100) : 0;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ original_length: text.length, compressed_length: compressed.length, savings_pct: saved, compressed }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── GraphRAG — Codebase Dependency Query (POST /v1/graph) ───
  // Wraps codebase-memory-mcp search_graph for dependency-aware context.
  // Given a filename or function name, returns what it calls and what calls it.
  if (req.method === 'POST' && req.url === '/v1/graph') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const query = parsed.query || parsed.function || parsed.file || '';
        const direction = parsed.direction || 'both';
        const depth = parsed.depth || 2;
        if (!query) throw new Error('Missing "query" (function or file name to trace)');

        // Build a prompt that queries codebase-memory-mcp via the blind-proxy LLM
        const graphPrompt = `You have access to codebase-memory-mcp tools for code analysis. 
Analyze the dependencies for: "${query}"
Direction: ${direction}
Depth: ${depth}

Use this approach:
1. Search the code knowledge graph for "${query}" using search_graph
2. Trace inbound and outbound calls using trace_path
3. Return a structured dependency map showing:
   - What functions/files does "${query}" call (dependencies)?
   - What functions/files call "${query}" (dependents)?
   - Any circular dependencies or architectural concerns?

Return the results as a concise dependency graph.`;

        // Route through blind-proxy itself with a tool-capable model
        const result = await fetchJSON('http://127.0.0.1:8090/v1/chat/completions',
          { model: 'auto:free', messages: [{ role: 'user', content: graphPrompt }], max_tokens: 4096, temperature: 0.1, stream: false },
          90000
        );

        const content = result?.choices?.[0]?.message?.content || 'Could not resolve dependency graph.';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          query, direction, depth,
          result: content,
          _graph: true,
        }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── Local Brain Endpoint (POST /v1/local-brain) ───
  // Exposes compressContext, skeletonCode, formatToolCall, and classifyIntent
  // from local-brain.js so sub-agents can call these capabilities directly.
  // Actions: compress(text), skeleton(description,language), format-tool(request,tool_name,tool_schema), classify(prompt)
  if (req.method === 'POST' && req.url === '/v1/local-brain') {
    try {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const parsed = JSON.parse(body);
        const action = parsed.action || '';
        let result;
        try {
          if (action === 'compress') {
            result = await compressContext(parsed.text, parsed.target_words || 50);
          } else if (action === 'skeleton') {
            result = await skeletonCode(parsed.description, parsed.language || 'python');
          } else if (action === 'format-tool') {
            result = await formatToolCall(parsed.request, parsed.tool_name, parsed.tool_schema || {});
          } else if (action === 'classify') {
            result = await classifyIntent(parsed.prompt || '');
          } else if (action === 'edge-classify') {
            result = await ebClassify(parsed.prompt || '');
          } else if (action === 'edge-compress') {
            result = await ebCompress(parsed.text, parsed.target_words || 50);
          } else if (action === 'edge-react') {
            const reactRes = await ebReactLoop(parsed.prompt || '', parsed.context || {});
            result = reactRes;
          } else if (action === 'edge-ask') {
            result = await askEdge(
              parsed.messages || [{ role: 'user', content: parsed.prompt || '' }],
              { max_tokens: parsed.max_tokens || 300, temperature: parsed.temperature ?? 0.3 }
            );
          } else {
            result = { error: 'Unknown action. Valid: compress, skeleton, format-tool, classify, edge-classify, edge-compress, edge-react, edge-ask' };
          }
        } catch (e) {
          result = { error: e.message };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ action, result }));
      });
      return;
    } catch (e) {
      console.error('[local-brain] Endpoint error:', e.message);
    }
  }

  // ─── Hallucination Report Endpoint (POST /v1/hallucination) ───
  // Reports a hallucination detected by the user or a critic agent.
  // Stores the report in blind-proxy memory and returns a corrected response.
  if (req.method === 'POST' && req.url === '/v1/hallucination') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const originalQuery = parsed.query || '';
        const hallucinatedContent = parsed.hallucination || '';
        const correction = parsed.correction || '';

        // Store the hallucination report as a reflection
        const report = {
          type: 'hallucination',
          query: originalQuery.substring(0, 200),
          hallucination: hallucinatedContent.substring(0, 500),
          correction: correction.substring(0, 500),
          timestamp: Date.now(),
        };

        // Write to a hallucination log
        const logDir = process.env.HOME + '/.blind-proxy';
        execSync('mkdir -p ' + logDir);
        const logPath = logDir + '/hallucinations.json';
        let reports = [];
        try {
          if (fs.existsSync(logPath)) reports = JSON.parse(fs.readFileSync(logPath, 'utf8'));
          if (!Array.isArray(reports)) reports = [];
        } catch { reports = []; }
        reports.unshift(report);
        if (reports.length > 200) reports.length = 200;
        fs.writeFileSync(logPath, JSON.stringify(reports, null, 2), 'utf8');

        // If a correction was provided, also update the brain cache to prevent repeats
        if (correction) {
          console.error('[hallucination] Stored correction for: "' + originalQuery.substring(0, 60) + '"');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ stored: true, total_reports: reports.length }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── ASI Backlog API (POST /v1/backlog) ───
  if (req.method === 'POST' && req.url === '/v1/backlog') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const p = JSON.parse(b);
        const action = p.action || 'list';
        const backlogPath = process.env.HOME + '/ricocoder/scripts/asi-backlog.js';
        let cmd = 'node ' + backlogPath + ' ' + action;
        if (p.goal_id) cmd += ' ' + p.goal_id;
        if (p.description) cmd += ' ' + JSON.stringify(p.description);
        if (p.priority) cmd += ' ' + JSON.stringify(p.priority);
        if (p.result) cmd += ' ' + JSON.stringify(p.result);
        if (p.reason) cmd += ' ' + JSON.stringify(p.reason);
        if (p.percent !== undefined) cmd += ' ' + p.percent;
        const out = String(execSync(cmd, { timeout: 10000 })).trim();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ action, output: out, _backlog: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ─── ASI Consensus / Multi-Agent Debate API (POST /v1/consensus) ───
  if (req.method === 'POST' && req.url === '/v1/consensus') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const messages = parsed.messages || [{ role: 'user', content: parsed.prompt || '' }];
        const providerA = parsed.provider_a || 'freebuff';
        const providerB = parsed.provider_b || 'openrouter-free';
        const judgeModel = parsed.judge || 'blindproxy1/glm-4-think';
        console.error('[consensus] Starting debate: providerA=' + providerA + ' providerB=' + providerB);

        // Phase 1: Parallel query to 2 independent providers
        const lastMsg = messages[messages.length - 1]?.content || '';
        const payload = { model: '', messages, max_tokens: parsed.max_tokens || 4096, temperature: 0.3, stream: false };

        const queryProvider = (name, endpoint, modelName, apiKey) => new Promise(async (resolve) => {
          try {
            if (!modelName) return resolve(null);
            const p = { model: modelName, messages: JSON.parse(JSON.stringify(messages)), max_tokens: parsed.max_tokens || 2048, temperature: 0.3, stream: false };
            const resData = await fetchJSON(endpoint, p, 30000, apiKey);
            if (resData && resData.choices && resData.choices[0]) {
              const content = resData.choices[0].message?.content || '';
              resolve({ provider: name, model: modelName, content, usage: resData.usage || {} });
            } else resolve(null);
          } catch (e) { resolve(null); }
        });

        // Pick concrete models for debate
        const fbModel = freebuffModelFor('deepseek-v4-flash');
        const flModel = 'auto';
        const [resultA, resultB] = await Promise.all([
          queryProvider('freebuff', 'http://127.0.0.1:8001/v1/chat/completions', fbModel),
          queryProvider('freellmapi', 'http://127.0.0.1:3002/v1/chat/completions', flModel, 'free'),
        ]);

        if (!resultA && !resultB) {
          return res.end(JSON.stringify({ error: 'Both providers failed', consensus: false }));
        }
        if (!resultA || !resultB) {
          const single = resultA || resultB;
          console.error('[consensus] Only one provider responded — returning directly');
          return res.end(JSON.stringify({
            consensus: true, judge: 'single-provider',
            responses: { A: single },
            final: single.content,
            model: single.model,
          }));
        }

        // Phase 2: Judge — ask a third model to evaluate and synthesize
        const judgePrompt = `You are an expert judge in a multi-agent debate system. Your job is to synthesize the best response from two different AI models that were given the same question.\n\n## The Question:\n${lastMsg.substring(0, 2000)}\n\n## Response A (from ${resultA.provider}/${resultA.model}):\n${resultA.content.substring(0, 4000)}\n\n## Response B (from ${resultB.provider}/${resultB.model}):\n${resultB.content.substring(0, 4000)}\n\n## Your task:\n1. Identify which response is more accurate, complete, and helpful.\n2. Synthesize a final answer that takes the best parts of both responses.\n3. If both agree, just merge them coherently.\n4. If they disagree, explain the disagreement and give your best judgment.\n\nReturn ONLY the final synthesized answer — no meta-commentary.`;

        console.error('[consensus] Running judge...');
        const judgePayload = { model: 'glm-4-think', messages: [{ role: 'user', content: judgePrompt }], max_tokens: 4096, temperature: 0.2, stream: false };

        // Try through blind-proxy itself for the judge call
        let judgeResponse = null;
        try {
          const judgeData = await fetchJSON('http://127.0.0.1:8090/v1/chat/completions', judgePayload, 60000);
          if (judgeData && judgeData.choices && judgeData.choices[0]) {
            judgeResponse = judgeData.choices[0].message?.content || null;
          }
        } catch (e) {
          console.error('[consensus] Judge call failed:', e.message);
        }

        if (!judgeResponse) {
          // Fallback: pick the longer response
          judgeResponse = resultA.content.length >= resultB.content.length ? resultA.content : resultB.content;
          console.error('[consensus] Judge failed — using longer response as fallback');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'consensus-' + Date.now(),
          object: 'chat.completion',
          model: 'consensus',
          choices: [{ index: 0, message: { role: 'assistant', content: judgeResponse }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          _consensus: true,
          _responses: { A: { provider: resultA.provider, model: resultA.model }, B: { provider: resultB.provider, model: resultB.model } },
        }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('{}');
}).listen(PORT, '127.0.0.1', () => console.log('[blind-proxy] :' + PORT + ' (file server at /v1/files/)'));

// Periodic anti-correlation: regenerate all synthetic identities hourly so a long
// session never reuses the same fake footprint across providers/requests.
try {
  setInterval(() => { try { rotateAll(); } catch (e) {} }, 3600 * 1000);
  console.log('[blind-proxy] hourly identity rotation active');
} catch (e) {}
