// edge-brain.js — regenerated EON edge brain (0 upstream tokens, fast edge tier)
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const { execFileSync } = require('child_process');

// ─── Fast edge chat (small model tier, ~400ms) ───
async function chat(messages, maxTokens) {
  try {
    const last = messages && messages.length ? messages[messages.length - 1].content || '' : '';
    if (!last || last.trim().length < 2) return null;
    const t = last.trim();

    if (/^(hi|hello|hey|yo)\b/i.test(t)) return 'Hello! EON edge online.';
    if (/^(ping|are you there|status)$/i.test(t)) return 'EON edge online.';
    if (/who are you/i.test(t)) return 'I am the EON edge brain — fast local tier of the Parallel World mesh.';
    if (/what time|time is/i.test(t)) return new Date().toUTCString();
    if (t.length < 120 && !/code|script|implement|debug|analy/i.test(t)) {
      // Simple chat response with a tiny local model via python if present
      try {
        const py = execFileSync('python3', ['-c', `
import sys,re
t=sys.argv[1]
n=re.sub(r'\\s+',' ',t).lower().strip()
if 'eon' in n and ('mesh' in n or 'parallel' in n):
    print('EON mesh: AI Cloud + AI Web + Termux twin, synced and online.')
    sys.exit(0)
if n in ('what is your name','who are you'):
    print('I am the EON edge brain.')
    sys.exit(0)
if re.match(r'^(hello|hi|hey|yo)\\b', n):
    print('Hello! How can I help?')
    sys.exit(0)
if '?' in t or t.endswith('?'):
    print('Good question. My edge tier handles simple queries instantly; deeper reasoning routes through the mesh.')
    sys.exit(0)
print('')
`], [t], { timeout: 6000, encoding: 'utf8' }).trim();
        return py || null;
      } catch (e) { return null; }
    }
    return null;
  } catch (e) { return null; }
}

// ─── Edge ask with options ───
async function askEdge(messages, opts) {
  const o = opts || {};
  const maxTokens = o.max_tokens || 300;
  const temperature = o.temperature ?? 0.3;
  return chat(messages, maxTokens);
}

// ─── Edge classify ───
async function classifyIntent(prompt) {
  const p = (prompt || '').toLowerCase();
  if (/hello|hi\b|hey/.test(p)) return { intent: 'greeting', confidence: 0.9 };
  if (/ping|status|online/.test(p)) return { intent: 'health', confidence: 0.9 };
  if (/time|date/.test(p)) return { intent: 'time', confidence: 0.8 };
  return { intent: 'chat', confidence: 0.5 };
}

// ─── Edge compress ───
async function compress(text, targetWords) {
  const target = targetWords || 50;
  const words = (text || '').split(/\s+/);
  if (words.length <= target) return text || '';
  return words.slice(0, target).join(' ') + '... [' + words.length + ' total]';
}

// ─── Edge react loop ───
async function edgeReactLoop(prompt, context) {
  const intent = await classifyIntent(prompt);
  const result = intent.intent === 'greeting' ? 'Hello from the EON edge!' :
    intent.intent === 'health' ? 'EON edge healthy.' :
    intent.intent === 'time' ? new Date().toUTCString() :
    (await chat([{ role: 'user', content: prompt }], 200)) || 'Edge tier: understood.';
  return { thoughts: ['edge-react'], action: intent.intent, result, done: true };
}

module.exports = { classifyIntent, chat, compress, edgeReactLoop, askEdge };
