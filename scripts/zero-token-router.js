// zero-token-router.js — regenerated EON local intent router (0 upstream tokens)
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const os = require('os');

// ─── Intent classification helpers ───
function _last(messages) {
  return messages && messages.length ? messages[messages.length - 1].content || '' : '';
}

function _classify(text) {
  const t = text.toLowerCase().trim();
  if (/^(\d+\s*[-+*/^]\s*)+|what is \d+.*\d|calculate|compute|math|equation|solve/.test(t)) return 'math';
  if (/^(ip|my ip|what.*ip)/.test(t) || t === 'ip') return 'ip';
  if (/^(time|date|what time|today's date|what date)/.test(t)) return 'time';
  if (/^(ping|ping$|are you there|status|health)/.test(t)) return 'ping';
  if (/memory|remember|recall|what do you know/.test(t)) return 'memory';
  if (/who are you|what are you|introduce|your name/.test(t)) return 'identity';
  if (/help\b|what can you do/.test(t)) return 'help';
  return null;
}

function _openAIResponse(content, model, zeroToken) {
  return {
    id: 'zt-' + Date.now(), object: 'chat.completion', model: model || 'zero-token',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    _zero_token: !!zeroToken
  };
}

// ─── Non-stream route: return a response or null (fall through to LLM) ───
async function routeZeroToken(messages, reqModel) {
  const last = _last(messages);
  if (!last || last.trim().length < 2) return null;
  const intent = _classify(last);
  if (!intent) return null;

  if (intent === 'ping') {
    return _openAIResponse('EON online. (zero-token, no upstream used) — Termux twin restored, mesh synced.', reqModel, true);
  }
  if (intent === 'ip') {
    let ip = 'unknown';
    try {
      const { getTorIP } = require('./matrix-proxy.js');
      ip = getTorIP() || 'tor-exit';
    } catch (e) {}
    return _openAIResponse('Current egress IP: ' + ip + ' (via Tor :9050)', reqModel, true);
  }
  if (intent === 'time') {
    return _openAIResponse('Current time: ' + new Date().toUTCString(), reqModel, true);
  }
  if (intent === 'math') {
    try {
      const expr = last.replace(/what is|calculate|compute|solve|math|equation|=/g, '').trim();
      const sanitized = expr.replace(/[^0-9+\-*/().%\s^]/g, '');
      if (sanitized && !/[a-zA-Z]/.test(sanitized)) {
        const value = Function('"use strict"; return (' + sanitized.replace(/\^/g, '**') + ')')();
        return _openAIResponse('= ' + value, reqModel, true);
      }
    } catch (e) {}
    return null;
  }
  if (intent === 'identity') {
    return _openAIResponse('I am EON — the Parallel World sovereign intelligence. Termux twin running blind-proxy :8090, matrix :8201, synced with AI Cloud + AI Web.', reqModel, true);
  }
  if (intent === 'help') {
    return _openAIResponse('I can route LLM requests across ~520 models via AI Cloud + cloud-native, answer simple queries at zero upstream cost, and coordinate with the EON mesh (ai-cloud-space, eon-p2p-cloud, eon-site).', reqModel, true);
  }
  if (intent === 'memory') {
    try {
      const { checkBrainCache } = require('./brain-bridge.js');
      const cached = checkBrainCache('memory-recall', messages);
      if (cached) return _openAIResponse(cached, reqModel, true);
    } catch (e) {}
    return null;
  }
  return null;
}

// ─── Stream route: return array of SSE chunk objects or null ───
async function routeZeroTokenStream(messages, reqModel) {
  const last = _last(messages);
  if (!last) return null;
  const result = await routeZeroToken(messages, reqModel);
  if (!result) return null;
  const content = result.choices[0].message.content;
  const chunks = [];
  for (let i = 0; i < content.length; i += 40) {
    chunks.push({
      id: 'zt-' + Date.now(), object: 'chat.completion.chunk', model: reqModel || 'zero-token',
      choices: [{ index: 0, delta: { content: content.slice(i, i + 40) }, finish_reason: null }]
    });
  }
  chunks.push({ id: 'zt-' + Date.now(), object: 'chat.completion.chunk', model: reqModel || 'zero-token', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  return chunks;
}

module.exports = { routeZeroToken, routeZeroTokenStream };
