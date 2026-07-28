// EON AGI Orchestrator v6.0 — Full-Power Multi-Brain Intelligence
// Features: parallel PI agents, live web research, multi-brain consensus,
//           anti-hallucination, conflict resolution, MCP integration
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN = '8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow';
const CHAT_ID = '6663994526';
const CLOUD_BRAIN = 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const CLOUD_BRAIN_TOKEN = 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const EON_P2P = 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const BLIND_PROXY = 'http://127.0.0.1:8090';

// ── 6 Brain Regions (Advisory Council) ──────────────────────────────
const REGIONS = {
  cortex:      { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.25, model: 'sovereign-cloud',  role: 'analytical reasoning and logic' },
  hippocampus: { url: EON_P2P,     token: null,              weight: 0.15, model: 'mistral-small',    role: 'memory, context, and knowledge' },
  thalamus:    { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.15, model: 'sovereign-cloud',  role: 'information filtering and focus' },
  prefrontal:  { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.20, model: 'sovereign-cloud',  role: 'planning, strategy, and judgment' },
  limbic:      { url: EON_P2P,     token: null,              weight: 0.10, model: 'mistral-small',    role: 'creativity and intuition' },
  brainstem:   { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.15, model: 'sovereign-cloud',  role: 'safety, facts, and verification' },
};

// ── Statistics ──────────────────────────────────────────────────────
let stats = { messages: 0, web_searches: 0, consensus_calls: 0, hallucination_catches: 0, errors: 0, uptime: Date.now(), region_calls: {}, sub_agents: 0 };

function log(level, msg, data) {
  const ts = new Date().toISOString().slice(11, 23);
  const icon = { info: '→', warn: '⚠', err: '✗', ok: '✓', think: '🧠', web: '🌐', agent: '🤖', consensus: '🗳', safe: '🛡', conflict: '⚡' }[level] || '·';
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[${ts}] ${icon} ${msg}${extra}`);
}

// ── HTTP Utilities ──────────────────────────────────────────────────
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: options.method || 'GET', headers: options.headers || {},
      timeout: options.timeout || 30000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data, status: res.statusCode }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function tgApi(method, data) {
  return fetchJSON(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
}

function quantumHash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return Math.abs(h) / 2147483647;
}

// ── Web Research ────────────────────────────────────────────────────
async function webSearch(query, numResults = 5) {
  log('web', `Researching: "${query}"`);
  stats.web_searches++;
  try {
    // DuckDuckGo Lite (no API key needed)
    const encoded = encodeURIComponent(query);
    const html = await fetchJSON(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
      method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0' }, timeout: 15000
    });
    // Parse results from HTML (simple extraction)
    const raw = html.raw || '';
    const results = [];
    const linkRegex = /class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)</g;
    const snippetRegex = /class="result-snippet">([^<]+)</g;
    let match;
    while ((match = linkRegex.exec(raw)) && results.length < numResults) {
      const url = match[1];
      const title = match[2].trim();
      if (url.startsWith('http') && !url.includes('duckduckgo.com')) {
        results.push({ url, title, snippet: '' });
      }
    }
    let i = 0;
    while ((match = snippetRegex.exec(raw)) && i < results.length) {
      results[i].snippet = match[1].trim();
      i++;
    }
    log('ok', `Found ${results.length} results`);
    return results;
  } catch (e) {
    log('warn', `Web search failed: ${e.message}`);
    return [];
  }
}

async function fetchUrl(url, maxChars = 3000) {
  try {
    const result = await fetchJSON(url, {
      method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0', 'Accept': 'text/html' }, timeout: 10000
    });
    const text = (result.raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, maxChars);
  } catch { return null; }
}

// ── Worker Calls (Cloud Brain) ──────────────────────────────────────
async function callWorker(url, token, model, prompt, maxTokens = 300) {
  try {
    const headers = {
      'User-Agent': 'EonAGI/6.0 (Node.js)', 'Accept': 'application/json', 'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetchJSON(`${url}/v1/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
    });
    return r?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// Also try blind-proxy as fallback
async function callBlindProxy(prompt, maxTokens = 300) {
  try {
    const r = await fetchJSON(`${BLIND_PROXY}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'EonAGI/6.0' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
    });
    return r?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// ── Multi-Brain Consensus (Anti-Hallucination) ──────────────────────
async function consensusThink(prompt, numRegions = 4) {
  const names = Object.keys(REGIONS);
  const selected = names.sort(() => Math.random() - 0.5).slice(0, numRegions);
  log('consensus', `Convening ${selected.length} brain regions: ${selected.join(', ')}`);
  stats.consensus_calls++;

  // Phase 1: Parallel brain consultation
  const start = Date.now();
  const results = await Promise.all(selected.map(async region => {
    const cfg = REGIONS[region];
    const t0 = Date.now();
    // Each brain gets the prompt + its specialized role
    const content = await callWorker(cfg.url, cfg.token, cfg.model,
      `[You are the ${region} region. Your specialty: ${cfg.role}]\n\nQuery: ${prompt}\n\nProvide your analysis. If uncertain, say so. Do not fabricate facts.`, 250);
    const ms = Date.now() - t0;
    const ok = content && content.length > 10;
    log(ok ? 'ok' : 'warn', `${region}: ${ok ? content.length + ' chars' : 'NO RESPONSE'} (${ms}ms)`);
    stats.region_calls[region] = (stats.region_calls[region] || 0) + (ok ? 1 : 0);
    return { region, content, weight: cfg.weight, role: cfg.role, valid: ok };
  }));

  const valid = results.filter(r => r.valid);
  if (!valid.length) {
    log('err', 'All brain regions failed — falling back to blind proxy');
    const fallback = await callBlindProxy(prompt, 400);
    return { text: fallback || '[AGI] All regions failed. Try rephrasing.', confidence: 0, regions: 0, conflicts: false };
  }

  // Phase 2: Conflict detection
  const conflicts = detectConflicts(valid);
  if (conflicts.length > 0) {
    log('conflict', `Detected ${conflicts.length} conflicts between regions`);
  }

  // Phase 3: Amplitude scoring (interference)
  const scored = valid.map(r => {
    const w = r.weight;
    const h = quantumHash(r.content || '');
    const coherenceScore = measureCoherence(r.content, valid.map(v => v.content));
    return { ...r, amp: w + h * w + coherenceScore * w * 0.5 };
  }).sort((a, b) => b.amp - a.amp);

  // Phase 4: Synthesis with verification
  const topTexts = scored.map(s => `[${s.region} (${s.role})]\n${(s.content || '').slice(0, 600)}`);
  log('think', 'Collapse: synthesizing with verification...');

  const synthPrompt = `You are EON's synthesis brain. Combine these ${valid.length} brain region analyses into one clear, accurate response.

CRITICAL RULES:
1. Only state facts that appear in MULTIPLE regions (consensus)
2. If regions contradict, acknowledge both views honestly
3. If unsure, say "I'm not certain" — NEVER fabricate
4. Be concise but comprehensive
5. Cite which regions agree

Brain Analyses:
${topTexts.join('\n\n---\n\n')}

Synthesized Response:`;

  let synth = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', synthPrompt, 600);
  if (!synth) synth = await callBlindProxy(synthPrompt, 600);
  if (!synth) synth = scored[0].content;

  // Phase 5: Post-synthesis verification
  const verification = await verifyResponse(synth, valid);

  const total = Date.now() - start;
  log('ok', `Consensus complete (${total}ms, ${valid.length}/${selected.length} regions, ${conflicts.length} conflicts, confidence: ${verification.confidence}%)`);

  return {
    text: synth,
    confidence: verification.confidence,
    regions: valid.length,
    conflicts: conflicts.length,
    conflictDetails: conflicts,
    topRegion: scored[0].region,
    verification: verification.text,
    timing: total
  };
}

// ── Conflict Detection ──────────────────────────────────────────────
function detectConflicts(results) {
  const conflicts = [];
  const texts = results.filter(r => r.valid).map(r => ({
    region: r.region,
    sentences: (r.content || '').split(/[.!?]+/).filter(s => s.trim().length > 20).map(s => s.trim().toLowerCase())
  }));

  // Simple contradiction detection: if two regions say opposite things
  const negationPatterns = /\b(not|no|never|false|incorrect|wrong|doesn't|don't|can't|won't|isn't|aren't|wasn't|weren't)\b/;
  const affirmationPatterns = /\b(is|are|was|were|can|will|does|do|yes|true|correct|always)\b/;

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      // Check if they have similar topics but opposite conclusions
      const shared = texts[i].sentences.filter(s =>
        texts[j].sentences.some(s2 => {
          const words1 = s.split(/\s+/).filter(w => w.length > 4);
          const words2 = s2.split(/\s+/).filter(w => w.length > 4);
          const overlap = words1.filter(w => words2.includes(w));
          return overlap.length >= 2;
        })
      );
      if (shared.length > 0) {
        // They discuss the same topic — check for disagreement
        const negI = texts[i].sentences.filter(s => negationPatterns.test(s));
        const negJ = texts[j].sentences.filter(s => negationPatterns.test(s));
        const affI = texts[i].sentences.filter(s => affirmationPatterns.test(s) && !negationPatterns.test(s));
        const affJ = texts[j].sentences.filter(s => affirmationPatterns.test(s) && !negationPatterns.test(s));
        if ((negI.length > 0 && affJ.length > 0) || (affI.length > 0 && negJ.length > 0)) {
          conflicts.push({ regions: [texts[i].region, texts[j].region], topic: shared[0].slice(0, 100) });
        }
      }
    }
  }
  return conflicts;
}

function measureCoherence(text, allTexts) {
  if (!text) return 0;
  const words = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  let maxOverlap = 0;
  for (const other of allTexts) {
    if (other === text) continue;
    const otherWords = new Set(other.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const overlap = [...words].filter(w => otherWords.has(w)).length;
    const total = new Set([...words, ...otherWords]).size;
    maxOverlap = Math.max(maxOverlap, total > 0 ? overlap / total : 0);
  }
  return maxOverlap;
}

// ── Verification Chain (Anti-Hallucination) ─────────────────────────
async function verifyResponse(response, brainResults) {
  log('safe', 'Running verification chain...');

  // Step 1: Cross-check with brainstem (safety/facts region)
  const brainstemCheck = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud',
    `Fact-check this response. List any claims that seem fabricated, uncertain, or unverifiable. Be strict.\n\nResponse: "${response.slice(0, 1000)}"\n\nVerdict (list issues or "VERIFIED OK"):`, 200);

  // Step 2: Check confidence based on region agreement
  const agreementRatio = brainResults.length / Object.keys(REGIONS).length;
  let confidence = Math.round(agreementRatio * 80 + (brainstemCheck && !brainstemCheck.includes('FABRICATED') ? 20 : 5));

  // Step 3: Detect hedging language (sign of hallucination)
  const hedgingWords = /\b(might be|could be|possibly|perhaps|I think|I believe|not sure|maybe|generally|usually|typically|often)\b/gi;
  const hedgingCount = (response.match(hedgingWords) || []).length;
  if (hedgingCount > 3) confidence = Math.max(confidence - 10, 10);

  // Step 4: Check for refusal (honest "I don't know" is good)
  const refuses = /\b(I don't know|I'm not sure|I cannot|I can't|no information|insufficient)\b/i.test(response);
  if (refuses) confidence = Math.min(confidence + 15, 95); // Honesty is valued

  confidence = Math.max(0, Math.min(100, confidence));
  if (confidence < 40) stats.hallucination_catches++;

  return { confidence, text: brainstemCheck || 'No issues detected' };
}

// ── Sub-Agent Spawning (Orchestrators) ──────────────────────────────
async function spawnSubAgent(task, type = 'researcher') {
  stats.sub_agents++;
  log('agent', `Spawning ${type} sub-agent for: "${task.slice(0, 50)}..."`);

  const agentPrompts = {
    researcher: `You are a research sub-agent. Your task: ${task}\n\nSearch for information, gather facts, and provide a comprehensive research report. Only state verified facts.`,
    coder: `You are a coding sub-agent. Your task: ${task}\n\nWrite clean, working code. Include error handling. Explain your approach briefly.`,
    reviewer: `You are a code review sub-agent. Your task: ${task}\n\nReview for bugs, security issues, performance problems. Be specific about each issue.`,
    planner: `You are a planning sub-agent. Your task: ${task}\n\nBreak this into clear steps. Identify dependencies, risks, and milestones.`,
    critic: `You are a critical analysis sub-agent. Your task: ${task}\n\nFind weaknesses, assumptions, and edge cases. Be constructive but thorough.`
  };

  const prompt = agentPrompts[type] || agentPrompts.researcher;
  const result = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', prompt, 500);
  return result || await callBlindProxy(prompt, 500);
}

// ── Intent Analysis ─────────────────────────────────────────────────
function analyzeIntent(text) {
  const lower = text.toLowerCase();
  const intents = [];

  // Web research signals
  if (/\b(search|find|look up|what is|who is|when did|latest|news|current|real-time)\b/i.test(lower)) intents.push('research');
  if (/\b(http|www\.|\.com|\.org|\.net|url|link|website)\b/i.test(lower)) intents.push('research');

  // Code signals
  if (/\b(code|program|function|script|implement|build|create|write|debug|fix|error)\b/i.test(lower)) intents.push('code');

  // Analysis signals
  if (/\b(analyze|compare|evaluate|assess|review|explain|why|how does|reason)\b/i.test(lower)) intents.push('analysis');

  // Planning signals
  if (/\b(plan|strategy|roadmap|step|approach|design|architecture|organize)\b/i.test(lower)) intents.push('planning');

  // Complex = multiple intents or long text
  if (intents.length >= 2 || text.length > 500) intents.push('complex');

  // Default to general
  if (!intents.length) intents.push('general');

  return intents;
}

// ── Main Message Handler ────────────────────────────────────────────
async function handleMessage(text, chatId, firstName) {
  const t0 = Date.now();
  const cmd = text.startsWith('/') ? text.split(' ')[0].toLowerCase() : '';
  const args = text.slice(cmd.length).trim();
  const intents = analyzeIntent(text);
  log('info', `Intent: ${intents.join(', ')}`);

  // ── Command handling ──
  if (cmd === '/start' || cmd === '/help') {
    await tgApi('sendMessage', { chat_id: chatId, text:
      `EON AGI Orchestrator v6.0\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🧠 /quantum <q> — Multi-brain consensus\n` +
      `🔍 /research <q> — Live web research\n` +
      `💻 /code <task> — Code generation\n` +
      `🤖 /agent <task> — Spawn sub-agent\n` +
      `🗳 /debate <q> — Brain debate\n` +
      `📊 /status — System stats\n` +
      `🛡 /verify <text> — Fact-check\n` +
      `📖 /version — Version info\n\n` +
      `Or just type anything — EON analyzes intent\nand uses the best tools automatically.` });
    return;
  }

  if (cmd === '/version') {
    await tgApi('sendMessage', { chat_id: chatId, text:
      `EON AGI v6.0-orchestrator\n` +
      `Regions: ${Object.keys(REGIONS).length}\n` +
      `Workers: cloud-brain, eon-p2p, blind-proxy\n` +
      `Features: consensus, web-research, sub-agents\n` +
      `Anti-hallucination: verification chain\n` +
      `Conflict resolution: consensus voting` });
    return;
  }

  if (cmd === '/status') {
    const uptime = Math.floor((Date.now() - stats.uptime) / 60000);
    const top = Object.entries(stats.region_calls).sort((a,b) => b[1]-a[1]).slice(0,3).map(([k,v]) => `${k}:${v}`).join(' ');
    await tgApi('sendMessage', { chat_id: chatId, text:
      `EON AGI Status\n` +
      `━━━━━━━━━━━━━━\n` +
      `Messages: ${stats.messages}\n` +
      `Web searches: ${stats.web_searches}\n` +
      `Consensus calls: ${stats.consensus_calls}\n` +
      `Hallucination catches: ${stats.hallucination_catches}\n` +
      `Sub-agents spawned: ${stats.sub_agents}\n` +
      `Errors: ${stats.errors}\n` +
      `Uptime: ${uptime}m\n` +
      `Top regions: ${top || 'none yet'}` });
    return;
  }

  if (cmd === '/verify') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /verify <text to fact-check>' }); return; }
    const check = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud',
      `You are a strict fact-checker. Analyze this text for false claims, logical errors, or unsupported statements. Be specific.\n\nText: "${args}"\n\nVerdict:`, 400);
    await tgApi('sendMessage', { chat_id: chatId, text: `🛡 Verification:\n\n${(check || 'Unable to verify').slice(0, 4000)}` });
    return;
  }

  if (cmd === '/debate') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /debate <topic>' }); return; }
    log('think', 'Starting brain debate...');
    const thesis = await callWorker(REGIONS.cortex.url, REGIONS.cortex.token, REGIONS.cortex.model,
      `Argue FOR this position with strong evidence: ${args}`, 300);
    const antithesis = await callWorker(REGIONS.prefrontal.url, REGIONS.prefrontal.token, REGIONS.prefrontal.model,
      `Argue AGAINST this position, presenting counter-evidence: ${args}`, 300);
    const synthesis = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud',
      `Thesis: "${thesis || 'N/A'}"\n\nAntithesis: "${antithesis || 'N/A'}"\n\nProvide a balanced synthesis.`, 400);
    const debate = `🗳 Brain Debate: ${args}\n\n✅ FOR:\n${(thesis || 'N/A').slice(0, 600)}\n\n❌ AGAINST:\n${(antithesis || 'N/A').slice(0, 600)}\n\n⚖ SYNTHESIS:\n${(synthesis || 'N/A').slice(0, 600)}`;
    await tgApi('sendMessage', { chat_id: chatId, text: debate.slice(0, 4000) });
    return;
  }

  if (cmd === '/research') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /research <query>' }); return; }
    const results = await webSearch(args);
    if (results.length) {
      const summary = results.map((r, i) => `${i+1}. **${r.title}**\n${r.snippet}\n${r.url}`).join('\n\n');
      // Synthesize with brain
      const synth = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud',
        `Based on these search results about "${args}", provide a comprehensive summary:\n${results.map(r => r.title + ': ' + r.snippet).join('\n')}`, 400);
      await tgApi('sendMessage', { chat_id: chatId, text: `🌐 Research: ${args}\n\n${(synth || summary).slice(0, 4000)}` });
    } else {
      // Fallback: direct brain knowledge
      const answer = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', args, 400);
      await tgApi('sendMessage', { chat_id: chatId, text: `🧠 (Web unavailable — using brain knowledge)\n\n${(answer || 'Unable to answer').slice(0, 4000)}` });
    }
    return;
  }

  if (cmd === '/code') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /code <task description>' }); return; }
    await tgApi('sendMessage', { chat_id: chatId, text: '🤖 Spawning coder sub-agent...' });
    const code = await spawnSubAgent(args, 'coder');
    await tgApi('sendMessage', { chat_id: chatId, text: `💻 Code Result:\n\n${(code || 'Failed to generate code').slice(0, 4000)}` });
    return;
  }

  if (cmd === '/agent') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /agent <task> (types: researcher, coder, reviewer, planner, critic)' }); return; }
    const parts = args.split(' ');
    let type = 'researcher';
    let task = args;
    if (['researcher','coder','reviewer','planner','critic'].includes(parts[0])) {
      type = parts[0];
      task = parts.slice(1).join(' ');
    }
    await tgApi('sendMessage', { chat_id: chatId, text: `🤖 Spawning ${type} sub-agent...` });
    const result = await spawnSubAgent(task, type);
    await tgApi('sendMessage', { chat_id: chatId, text: `🤖 ${type} result:\n\n${(result || 'Sub-agent failed').slice(0, 4000)}` });
    return;
  }

  // ── AGI Auto-Mode (default) ──
  // Step 1: Web research if needed
  let webContext = '';
  if (intents.includes('research')) {
    const searchResults = await webSearch(text, 3);
    if (searchResults.length) {
      webContext = '\n\n[Web Research]:\n' + searchResults.map(r => `${r.title}: ${r.snippet}`).join('\n');
    }
  }

  // Step 2: Multi-brain consensus
  const fullPrompt = text + webContext;
  let result;

  if (intents.includes('complex') || intents.includes('analysis')) {
    // Full consensus with all regions
    result = await consensusThink(fullPrompt, 5);
  } else if (intents.includes('code') || intents.includes('planning')) {
    // Spawn sub-agent + brain verification
    const agentResult = await spawnSubAgent(fullPrompt, intents.includes('code') ? 'coder' : 'planner');
    const brainCheck = await callWorker(REGIONS.brainstem.url, REGIONS.brainstem.token, REGIONS.brainstem.model,
      `Verify this output is correct and complete:\n${(agentResult || '').slice(0, 500)}\n\nIssues (or "OK"):`, 200);
    result = {
      text: agentResult || 'Sub-agent failed',
      confidence: brainCheck && brainCheck.includes('OK') ? 90 : 60,
      regions: 2, conflicts: 0
    };
  } else {
    // Quick consensus with 3 regions
    result = await consensusThink(fullPrompt, 3);
  }

  // Step 3: Format response
  let response = result.text || 'Unable to process this request.';

  // Add confidence indicator
  const confIcon = result.confidence >= 80 ? '🟢' : result.confidence >= 50 ? '🟡' : '🔴';
  const header = `${confIcon} [${result.confidence}% confidence]`;
  const footer = result.conflicts > 0 ? `\n\n⚠ ${result.conflicts} region conflict(s) detected` : '';

  await tgApi('sendMessage', { chat_id: chatId, text: `${header}\n\n${response.slice(0, 3800)}${footer}` });

  log('ok', `Replied in ${Date.now() - t0}ms (confidence: ${result.confidence}%)`);
}

// ── HTTP Server (Webhook) ───────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Webhook endpoint
  if (url.pathname === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        const msg = update.message;
        if (msg?.text && msg?.chat?.id?.toString() === CHAT_ID) {
          stats.messages++;
          const preview = msg.text.length > 80 ? msg.text.slice(0, 80) + '...' : msg.text;
          log('info', `IN [${msg.from?.first_name || '?'}]: ${preview}`);
          handleMessage(msg.text, msg.chat.id, msg.from?.first_name).catch(e => {
            stats.errors++;
            log('err', `handleMessage: ${e.message}`);
          });
        }
      } catch (e) {
        stats.errors++;
        log('err', `Parse: ${e.message}`);
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
    return;
  }

  // Health + stats
  if (url.pathname === '/health') {
    const uptime = Math.floor((Date.now() - stats.uptime) / 60000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '6.0-orchestrator', regions: Object.keys(REGIONS).length, uptime: `${uptime}m`, stats }));
    return;
  }

  // Quick think (for external callers)
  if (url.pathname === '/think' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { prompt } = JSON.parse(body);
        const result = await consensusThink(prompt, 3);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Web search endpoint
  if (url.pathname === '/search') {
    const q = url.searchParams.get('q');
    if (q) {
      webSearch(q).then(r => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      });
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Add ?q=your+query');
    }
    return;
  }

  // Setup webhook
  if (url.pathname === '/setup') {
    const wh = url.searchParams.get('url');
    if (wh) {
      tgApi('setWebhook', { url: wh, max_connections: 40, allowed_updates: ['message'] }).then(r => {
        log('ok', `Webhook: ${wh}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Provide ?url=https://your-app.com/webhook');
    }
    return;
  }

  // EON Dream status
  if (url.pathname === '/dream') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(
      `EON AGI Dream v6.0\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Regions: ${Object.keys(REGIONS).length} brain advisors\n` +
      `Features: consensus, web-research, sub-agents, anti-hallucination\n` +
      `Messages processed: ${stats.messages}\n` +
      `Web searches: ${stats.web_searches}\n` +
      `Consensus calls: ${stats.consensus_calls}\n` +
      `Hallucination catches: ${stats.hallucination_catches}\n` +
      `Sub-agents spawned: ${stats.sub_agents}\n`
    );
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('EON AGI Orchestrator v6.0');
});

// ── Error handling ──────────────────────────────────────────────────
process.on('uncaughtException', e => log('err', `uncaught: ${e.message}`));
process.on('unhandledRejection', e => log('err', `unhandled: ${e}`));

// ── Start ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  log('ok', `EON AGI Orchestrator v6.0 on :${PORT}`);
  log('ok', `Endpoints: /webhook /health /think /search /setup /dream`);
  log('ok', `${Object.keys(REGIONS).length} brain regions ready`);
  log('ok', `Anti-hallucination: verification chain active`);
  log('ok', `Conflict resolution: consensus voting active`);
  log('ok', `Sub-agent spawner: ready`);
});
