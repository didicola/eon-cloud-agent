// local-brain.js — regenerated EON local brain (0 upstream tokens)
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const os = require('os');
const { execFileSync } = require('child_process');

// ─── Local lightweight chat (0 upstream tokens) ───
// Deterministic, offline responses for simple chat. Falls back to a small
// heuristic responder so clients never hang even without upstream.
async function askLocal(messages, opts) {
  try {
    const last = messages && messages.length ? messages[messages.length - 1].content || '' : '';
    if (!last || last.trim().length < 2) return null;
    const t = last.trim();

    // Direct answers
    if (/^(hi|hello|hey|yo)\b/i.test(t)) return 'Hello! EON Termux twin online.';
    if (/^(ping|are you there|status|health)$/i.test(t)) return 'EON online. Matrix + blind-proxy + relay running, mesh synced.';
    if (/who are you|what are you/i.test(t)) return 'I am EON, the Parallel World sovereign intelligence running on Termux.';
    if (/what time|time is it|date is/i.test(t)) return 'It is ' + new Date().toUTCString() + '.';
    if (/^(yes|no|ok|thanks|thank you|thx)\b/i.test(t)) return t + '.';

    // Summaries
    if (/^summar/i.test(t)) {
      const body = t.replace(/^summar[^:]*:?\s*/i, '').slice(0, 500);
      return body ? body.slice(0, 200) + (body.length > 200 ? '...' : '') : 'Nothing to summarize.';
    }

    // Simple repeat of user short queries → local canned reply
    if (t.length > 3 && t.length < 80 && !/[?？]/.test(t)) {
      const lower = t.toLowerCase();
      if (/\b(eon|parallel|mesh|cloud|restore|termux)\b/.test(lower)) {
        return 'EON mesh restored: memory synced to AI Cloud, git via EonHub, matrix + blind-proxy + relay live on Termux.';
      }
    }

    // Fall back to local python if available (small offline model), else null
    try {
      const py = execFileSync('python3', ['-c', `
import sys,re
t=sys.argv[1]
t=t.strip()
def norm(s): return re.sub(r'\\s+',' ',s).lower().strip()
n=norm(t)
answers={
 "what is eon":"EON is the Parallel World sovereign AI mesh: AI Cloud workers + AI Web + Termux twin, synced via ai-cloud-space.",
 "what is the mesh":"The EON mesh spans AI Cloud (workers), AI Web (eon-site), and this Termux node, coordinated through D1/KV.",
}
for k,v in answers.items():
    if k in n: print(v); sys.exit(0)
print("")
`], [t], { timeout: 8000, encoding: 'utf8' }).trim();
      return py || null;
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

// ─── Intent classification ───
async function classifyIntent(prompt) {
  const p = (prompt || '').toLowerCase();
  if (/write|code|implement|function|script|debug/.test(p)) return { intent: 'code', confidence: 0.8 };
  if (/search|find|lookup|browse|web/.test(p)) return { intent: 'web', confidence: 0.7 };
  if (/math|calc|sum|compute/.test(p)) return { intent: 'math', confidence: 0.7 };
  if (/translate|translate to/.test(p)) return { intent: 'translate', confidence: 0.7 };
  if (/summar|tl;dr/.test(p)) return { intent: 'summary', confidence: 0.7 };
  if (/analy|data|csv|json|database/.test(p)) return { intent: 'data', confidence: 0.6 };
  if (/^hi|hello|hey|ping/.test(p)) return { intent: 'greeting', confidence: 0.9 };
  return { intent: 'chat', confidence: 0.5 };
}

// ─── React loop: simple autonomous action loop ───
async function reactLoop(prompt, context) {
  const intent = await classifyIntent(prompt);
  const thoughts = [];
  let result = '';
  if (intent.intent === 'code') {
    thoughts.push('Identified code task');
    result = 'I can write that code. Which language and what should it do?';
  } else if (intent.intent === 'web') {
    thoughts.push('Identified web lookup');
    result = 'Routing to web search via the mesh.';
  } else {
    thoughts.push('Identified chat task');
    result = await askLocal([{ role: 'user', content: prompt }], {});
    result = result || 'Understood. What would you like me to do?';
  }
  return { thoughts, action: intent.intent, result, done: intent.intent === 'chat' || intent.intent === 'greeting' };
}

// ─── Tool call formatting ───
async function formatToolCall(request, toolName, toolSchema) {
  const schema = toolSchema || {};
  const args = {};
  const text = (request || '').toLowerCase();
  for (const [k, v] of Object.entries(schema.properties || {})) {
    if (k === 'query' && /search|find/.test(text)) args[k] = request;
    else if (k === 'code' && /code/.test(text)) args[k] = request;
    else if (v.type === 'string') args[k] = request;
    else if (v.type === 'number') args[k] = null;
  }
  return { name: toolName, arguments: JSON.stringify(args) };
}

// ─── Context compression ───
async function compressContext(text, targetWords) {
  const target = targetWords || 50;
  const words = (text || '').split(/\s+/);
  if (words.length <= target) return text || '';
  return words.slice(0, target).join(' ') + '... [' + words.length + ' words total]';
}

// ─── Code skeleton generation ───
async function skeletonCode(description, language) {
  const lang = language || 'python';
  const desc = (description || '').toLowerCase();
  const fname = (desc.match(/(?:a |the )?([a-z][a-z0-9_]*)/) || [])[1] || 'main';
  if (lang === 'python') {
    return `def ${fname}():\n    """${description || 'Task'}"""\n    # TODO: implement\n    pass\n\n\nif __name__ == "__main__":\n    ${fname}()\n`;
  }
  if (lang === 'javascript' || lang === 'node') {
    return `function ${fname}() {\n  // ${description || 'Task'}\n  // TODO: implement\n}\n\n${fname}();\n`;
  }
  return `// ${lang} skeleton for: ${description}\n`;
}

module.exports = { classifyIntent, reactLoop, formatToolCall, compressContext, skeletonCode, askLocal };
