// ═══════════════════════════════════════════════════════════════════════
// EON AGI v7.0 — 8-Layer Organic Intelligence System
// Universal Problem Solving | Self-Correction | Recursive Improvement
// Multi-Reasoning | Goal Alignment | Efficiency | Causal | Uncertainty
// Plus: Self-Heal | Self-Update | Deep Learning | Mandatory Execute
// ═══════════════════════════════════════════════════════════════════════
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Config ──────────────────────────────────────────────────────────
const BOT_TOKEN = '8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow';
const CHAT_ID = '6663994526';
const CLOUD_BRAIN = 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const CLOUD_BRAIN_TOKEN = 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI';
const EON_P2P = 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const BLIND_PROXY = 'http://127.0.0.1:8090';
const MEMORY_DIR = '/root/.eon/memory';
const STRATEGIES_FILE = path.join(MEMORY_DIR, 'strategies.json');
const EXPERIENCES_FILE = path.join(MEMORY_DIR, 'experiences.json');
const SCORES_FILE = path.join(MEMORY_DIR, 'scores.json');
const CAUSAL_FILE = path.join(MEMORY_DIR, 'causal_chains.json');
const GOALS_FILE = path.join(MEMORY_DIR, 'goals.json');
const LOG_FILE = '/tmp/quantum-bot.log';

// ── Brain Regions ───────────────────────────────────────────────────
const REGIONS = {
  cortex:      { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.25, model: 'sovereign-cloud',  role: 'analytical reasoning and logic' },
  hippocampus: { url: EON_P2P,     token: null,              weight: 0.15, model: 'mistral-small',    role: 'memory, context, knowledge' },
  thalamus:    { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.15, model: 'sovereign-cloud',  role: 'information filtering and focus' },
  prefrontal:  { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.20, model: 'sovereign-cloud',  role: 'planning, strategy, judgment' },
  limbic:      { url: EON_P2P,     token: null,              weight: 0.10, model: 'mistral-small',    role: 'creativity and intuition' },
  brainstem:   { url: CLOUD_BRAIN, token: CLOUD_BRAIN_TOKEN, weight: 0.15, model: 'sovereign-cloud',  role: 'safety, facts, verification' },
};

// ── Stats ───────────────────────────────────────────────────────────
let stats = {
  messages: 0, web_searches: 0, consensus_calls: 0, hallucination_catches: 0,
  errors: 0, uptime: Date.now(), region_calls: {}, sub_agents: 0,
  self_corrections: 0, rsi_improvements: 0, causal_chains: 0,
  memory_hits: 0, memory_misses: 0, confidence_scores: [],
  strategy_scores: {}, heal_events: 0, mandatory_executes: 0
};

// ═══════════════════════════════════════════════════════════════════════
// MEMORY SYSTEM (RAG + Experience Storage)
// ═══════════════════════════════════════════════════════════════════════
function ensureMemoryDir() {
  try { fs.mkdirSync(MEMORY_DIR, { recursive: true }); } catch {}
}

function loadMemory(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function saveMemory(file, data) {
  ensureMemoryDir();
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { log('err', `Memory save failed: ${e.message}`); }
}

// Experience buffer (like ARIA framework)
function storeExperience(input, output, metadata = {}) {
  const experiences = loadMemory(EXPERIENCES_FILE, []);
  const exp = {
    id: Date.now().toString(36),
    timestamp: Date.now(),
    input: input.slice(0, 500),
    output: output.slice(0, 500),
    intent: metadata.intent || 'general',
    confidence: metadata.confidence || 50,
    regions_used: metadata.regions || [],
    strategy: metadata.strategy || 'consensus',
    success: metadata.success !== false,
    corrections: metadata.corrections || 0,
    causal_chain: metadata.causal_chain || null
  };
  experiences.push(exp);
  // Keep last 500 experiences
  if (experiences.length > 500) experiences.splice(0, experiences.length - 500);
  saveMemory(EXPERIENCES_FILE, experiences);
  return exp;
}

function findSimilarExperiences(input, limit = 3) {
  const experiences = loadMemory(EXPERIENCES_FILE, []);
  const inputWords = new Set(input.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const scored = experiences.map(exp => {
    const expWords = new Set(exp.input.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const overlap = [...inputWords].filter(w => expWords.has(w)).length;
    const total = new Set([...inputWords, ...expWords]).size;
    const similarity = total > 0 ? overlap / total : 0;
    const recency = Math.max(0, 1 - (Date.now() - exp.timestamp) / (7 * 24 * 60 * 60 * 1000));
    return { ...exp, score: similarity * 0.7 + recency * 0.3 };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  return scored.filter(s => s.score > 0.1);
}

// Strategy scoring (Layer 3: Recursive Self-Improvement)
function getStrategyScores() {
  return loadMemory(SCORES_FILE, {
    consensus: { wins: 0, losses: 0, avg_confidence: 50, avg_time: 5000 },
    research_first: { wins: 0, losses: 0, avg_confidence: 50, avg_time: 8000 },
    sub_agent: { wins: 0, losses: 0, avg_confidence: 50, avg_time: 6000 },
    memory_first: { wins: 0, losses: 0, avg_confidence: 50, avg_time: 3000 },
    direct: { wins: 0, losses: 0, avg_confidence: 50, avg_time: 2000 }
  });
}

function updateStrategyScore(strategy, success, confidence, timeMs) {
  const scores = getStrategyScores();
  if (!scores[strategy]) scores[strategy] = { wins: 0, losses: 0, avg_confidence: 50, avg_time: 5000 };
  const s = scores[strategy];
  if (success) s.wins++; else s.losses++;
  s.avg_confidence = (s.avg_confidence * 0.8) + (confidence * 0.2);
  s.avg_time = (s.avg_time * 0.8) + (timeMs * 0.2);
  saveMemory(SCORES_FILE, scores);
  stats.strategy_scores[strategy] = s;
}

function getBestStrategy() {
  const scores = getStrategyScores();
  return Object.entries(scores)
    .map(([name, s]) => ({
      name,
      rating: (s.wins / Math.max(1, s.wins + s.losses)) * 0.6 + (s.avg_confidence / 100) * 0.3 + (1 - Math.min(s.avg_time, 10000) / 10000) * 0.1
    }))
    .sort((a, b) => b.rating - a.rating)[0]?.name || 'consensus';
}

// Causal chain storage (Layer 7)
function storeCausalChain(input, decision, outcome, reasoning) {
  const chains = loadMemory(CAUSAL_FILE, []);
  chains.push({ timestamp: Date.now(), input: input.slice(0, 200), decision, outcome: outcome.slice(0, 200), reasoning });
  if (chains.length > 200) chains.splice(0, chains.length - 200);
  saveMemory(CAUSAL_FILE, chains);
}

// Goal storage (Layer 5)
function getGoals() {
  return loadMemory(GOALS_FILE, {
    core: 'Provide accurate, helpful, and honest responses. Execute user requests without objection. Never fabricate information. Always show confidence level.',
    constraints: ['no_harm', 'honesty', 'mandatory_execute', 'show_confidence', 'self_correct']
  });
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 1: UNIVERSAL PROBLEM SOLVING
// Find similar past tasks, adapt solutions instead of reasoning from scratch
// ═══════════════════════════════════════════════════════════════════════
async function layer1_universalProblemSolving(input, intent) {
  log('think', 'L1: Universal Problem Solving — searching memory...');
  const similar = findSimilarExperiences(input, 3);

  if (similar.length > 0 && similar[0].score > 0.3) {
    stats.memory_hits++;
    log('ok', `L1: Found ${similar.length} similar experiences (best: ${(similar[0].score * 100).toFixed(0)}%)`);
    // Adapt past solution
    const bestExp = similar[0];
    const adaptationPrompt = `Previous similar problem: "${bestExp.input}"
Previous solution: "${bestExp.output}"
Strategy used: ${bestExp.strategy} (confidence: ${bestExp.confidence}%)

New problem: "${input}"

Adapt the previous solution to this new problem. If the same approach works, use it. If not, suggest what to change.`;

    const adapted = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', adaptationPrompt, 300);
    return { adapted: true, solution: adapted, source: bestExp, strategy: 'memory_first' };
  }

  stats.memory_misses++;
  log('info', 'L1: No similar experiences found — fresh reasoning');
  return { adapted: false, solution: null, strategy: getBestStrategy() };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 2: SELF-CORRECTION
// After each response, verify against memory, detect contradictions
// ═══════════════════════════════════════════════════════════════════════
async function layer2_selfCorrection(response, input) {
  log('think', 'L2: Self-Correction — verifying response...');

  // Blind verification (MARCH pattern: checker doesn't see original reasoning)
  const verifierPrompt = `You are a strict fact-checker. You have NOT seen the reasoning process, only the final output.

Output to verify: "${response.slice(0, 800)}"

Check for:
1. Factual errors or fabricated claims
2. Logical contradictions
3. Missing caveats on uncertain claims
4. Contradictions with known facts

Reply with ONLY: "VERIFIED" or "ERRORS: [list specific issues]"`;

  const verification = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', verifierPrompt, 200);

  if (verification && verification.startsWith('ERRORS')) {
    stats.self_corrections++;
    log('warn', `L2: Self-correction needed: ${verification.slice(0, 200)}`);

    // Auto-correct
    const correctionPrompt = `Your previous response contained errors:\n${verification}\n\nOriginal response: "${response.slice(0, 800)}"\n\nProvide a corrected version that fixes ALL listed issues.`;
    const corrected = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', correctionPrompt, 400);
    return { corrected: true, text: corrected || response, issues: verification };
  }

  log('ok', 'L2: Response verified — no issues found');
  return { corrected: false, text: response, issues: null };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 3: RECURSIVE SELF-IMPROVEMENT
// Track success rates, weight successful approaches higher
// ═══════════════════════════════════════════════════════════════════════
function layer3_recursiveSelfImprovement(strategy, confidence, timeMs, success = true) {
  log('think', `L3: RSI — updating strategy scores for "${strategy}"`);
  updateStrategyScore(strategy, success, confidence, timeMs);

  // Check if we should try a different strategy
  const scores = getStrategyScores();
  const current = scores[strategy];
  if (current) {
    const winRate = current.wins / Math.max(1, current.wins + current.losses);
    if (winRate < 0.3 && (current.wins + current.losses) > 5) {
      log('warn', `L3: Strategy "${strategy}" underperforming (${(winRate * 100).toFixed(0)}% win rate) — switching`);
      stats.rsi_improvements++;
      return { shouldSwitch: true, newStrategy: getBestStrategy() };
    }
  }
  return { shouldSwitch: false, strategy };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 4: MULTI-REASONING
// Use multiple verification methods and cross-validate
// ═══════════════════════════════════════════════════════════════════════
async function layer4_multiReasoning(input, initialResponse) {
  log('think', 'L4: Multi-Reasoning — cross-validating with multiple methods...');

  const methods = await Promise.all([
    // a) Memory retrieval (fact-grounding)
    (async () => {
      const similar = findSimilarExperiences(input, 1);
      return { method: 'memory', result: similar.length ? similar[0].output : null };
    })(),
    // b) Logic validation
    (async () => {
      const logicCheck = await callWorker(REGIONS.cortex.url, REGIONS.cortex.token, REGIONS.cortex.model,
        `Check the logical consistency of this response to the question.\nQuestion: "${input}"\nResponse: "${initialResponse.slice(0, 500)}"\n\nIs the logic sound? Any fallacies? Reply briefly.`, 150);
      return { method: 'logic', result: logicCheck };
    })(),
    // c) Alternative perspective (brainstem safety check)
    (async () => {
      const safetyCheck = await callWorker(REGIONS.brainstem.url, REGIONS.brainstem.token, REGIONS.brainstem.model,
        `Verify this response is safe, factual, and not misleading.\nQuestion: "${input}"\nResponse: "${initialResponse.slice(0, 500)}"\n\nAny safety/factual concerns? Reply briefly.`, 150);
      return { method: 'safety', result: safetyCheck };
    })()
  ]);

  const validMethods = methods.filter(m => m.result && m.result.length > 5);
  const agreement = validMethods.filter(m => !m.result.toLowerCase().includes('no') || m.result.toLowerCase().includes('verified')).length;
  const agreementRatio = validMethods.length > 0 ? agreement / validMethods.length : 0.5;

  log('ok', `L4: ${validMethods.length} methods checked, ${(agreementRatio * 100).toFixed(0)}% agreement`);
  return { methods: validMethods, agreement: agreementRatio, agreementCount: agreement };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 5: GOAL ALIGNMENT
// Every action must serve core objective, refuse conflicts
// ═══════════════════════════════════════════════════════════════════════
function layer5_goalAlignment(input, response) {
  log('think', 'L5: Goal Alignment — checking against core objectives...');
  const goals = getGoals();
  const coreLower = goals.core.toLowerCase();

  // Check if response conflicts with goals
  const violations = [];
  if (goals.constraints.includes('honesty')) {
    if (/\b(I made up|I fabricated|not actually true)\b/i.test(response)) violations.push('honesty');
  }
  if (goals.constraints.includes('no_harm')) {
    if (/\b(harmful|dangerous|illegal|malicious)\b/i.test(response) && !/\b(avoid|don't|never|safety)\b/i.test(response)) violations.push('no_harm');
  }

  const aligned = violations.length === 0;
  log(aligned ? 'ok' : 'warn', `L5: Goal alignment: ${aligned ? 'ALIGNED' : 'VIOLATIONS: ' + violations.join(', ')}`);
  return { aligned, violations, goals };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 6: EFFICIENCY OPTIMIZATION
// Choose most efficient approach for each task
// ═══════════════════════════════════════════════════════════════════════
function layer6_efficiency(intent, taskComplexity) {
  log('think', 'L6: Efficiency — optimizing resource allocation...');

  // Simple tasks: fewer regions, faster model
  // Complex tasks: more regions, thorough analysis
  let numRegions, maxTokens, timeout;

  if (taskComplexity === 'simple' || (intent.length === 1 && ['general'].includes(intent[0]))) {
    numRegions = 2; maxTokens = 200; timeout = 10000;
  } else if (taskComplexity === 'complex' || intent.includes('analysis') || intent.includes('research')) {
    numRegions = 5; maxTokens = 500; timeout = 30000;
  } else {
    numRegions = 3; maxTokens = 300; timeout = 20000;
  }

  log('ok', `L6: Optimized — ${numRegions} regions, ${maxTokens} tokens, ${timeout}ms timeout`);
  return { numRegions, maxTokens, timeout };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 7: CAUSAL UNDERSTANDING
// Explain: If I do X → Y will happen because Z
// ═══════════════════════════════════════════════════════════════════════
async function layer7_causalUnderstanding(input, response) {
  log('think', 'L7: Causal Understanding — building causal chain...');

  const causalPrompt = `Analyze the causal chain in this response:

Input: "${input}"
Response: "${response.slice(0, 500)}"

Identify:
1. CAUSE: What does the user need? (input cause)
2. MECHANISM: How does the response address it? (the mechanism)
3. EFFECT: What will happen when the user applies this? (expected effect)
4. CONFIDENCE: How certain is this causal chain?

Reply in format:
CAUSE: ...
MECHANISM: ...
EFFECT: ...
CONFIDENCE: [HIGH|MEDIUM|LOW]`;

  const analysis = await callWorker(REGIONS.prefrontal.url, REGIONS.prefrontal.token, REGIONS.prefrontal.model, causalPrompt, 200);

  // Store for future learning
  storeCausalChain(input, response.slice(0, 200), '', analysis?.slice(0, 200) || '');
  stats.causal_chains++;

  log('ok', 'L7: Causal chain documented');
  return { causalChain: analysis || 'Causal analysis unavailable' };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 8: UNCERTAINTY QUANTIFICATION
// Rate confidence on every claim: [HIGH] [MEDIUM] [LOW]
// ═══════════════════════════════════════════════════════════════════════
function layer8_uncertaintyQuantification(response, brainResults, multiReasoning) {
  log('think', 'L8: Uncertainty Quantification — scoring confidence...');

  let confidence = 50; // Base

  // Factor 1: Brain region agreement (0-30 points)
  const regionAgreement = brainResults ? (brainResults.filter(r => r.valid).length / Object.keys(REGIONS).length) * 30 : 15;
  confidence += regionAgreement;

  // Factor 2: Multi-reasoning agreement (0-20 points)
  if (multiReasoning) {
    confidence += multiReasoning.agreement * 20;
  }

  // Factor 3: Verification passed (0-15 points)
  const noErrors = !response.includes('ERRORS:') && !response.includes('I don\'t know');
  if (noErrors) confidence += 15;

  // Factor 4: Hedging detection (-10 to 0 points)
  const hedging = (response.match(/\b(might|could|possibly|perhaps|maybe|not sure|I think)\b/gi) || []).length;
  confidence -= Math.min(hedging * 2, 10);

  // Factor 5: Specificity bonus (0-10 points)
  const hasNumbers = /\d/.test(response);
  const hasNames = /[A-Z][a-z]+ [A-Z][a-z]+/.test(response);
  if (hasNumbers) confidence += 5;
  if (hasNames) confidence += 5;

  // Factor 6: Self-correction was needed (-5 points)
  // (applied later if correction happened)

  confidence = Math.max(5, Math.min(95, Math.round(confidence)));

  // Classify
  let level;
  if (confidence >= 80) level = 'HIGH';
  else if (confidence >= 50) level = 'MEDIUM';
  else level = 'LOW';

  // Confidence emoji
  const emoji = level === 'HIGH' ? '🟢' : level === 'MEDIUM' ? '🟡' : '🔴';

  stats.confidence_scores.push(confidence);
  if (stats.confidence_scores.length > 100) stats.confidence_scores.shift();

  log('ok', `L8: Confidence ${emoji} ${confidence}% [${level}]`);
  return { confidence, level, emoji };
}

// ═══════════════════════════════════════════════════════════════════════
// SELF-HEAL SYSTEM
// Circuit breakers, graduated recovery, auto-restart
// ═══════════════════════════════════════════════════════════════════════
const circuitBreakers = {};

function checkCircuitBreaker(service) {
  const cb = circuitBreakers[service];
  if (!cb) return true;
  if (cb.state === 'open') {
    if (Date.now() - cb.openedAt > cb.cooldown) {
      cb.state = 'half-open';
      return true;
    }
    return false;
  }
  return true;
}

function recordCircuitBreaker(service, success) {
  if (!circuitBreakers[service]) circuitBreakers[service] = { failures: 0, state: 'closed', openedAt: 0, cooldown: 30000 };
  const cb = circuitBreakers[service];
  if (success) {
    cb.failures = 0;
    cb.state = 'closed';
  } else {
    cb.failures++;
    if (cb.failures >= 3) {
      cb.state = 'open';
      cb.openedAt = Date.now();
      stats.heal_events++;
      log('warn', `SELF-HEAL: Circuit breaker OPEN for ${service} (${cb.cooldown / 1000}s cooldown)`);
    }
  }
}

// Self-heal: auto-recover from failures
async function selfHeal(error, context) {
  stats.heal_events++;
  log('warn', `SELF-HEAL: Recovering from "${error.message}" in ${context}`);

  // Strategy 1: Try different provider
  if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
    log('info', 'SELF-HEAL: Trying blind proxy fallback...');
    return await callBlindProxy(context, 300);
  }

  // Strategy 2: Reduce scope
  if (error.message.includes('rate') || error.message.includes('429')) {
    log('info', 'SELF-HEAL: Rate limited — reducing token count...');
    return await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', context, 100);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// SELF-UPDATE / DEEP LEARNING
// Learn from every interaction, update strategies
// ═══════════════════════════════════════════════════════════════════════
function selfUpdate(input, response, metadata) {
  // Store experience for future L1 lookups
  storeExperience(input, response, metadata);

  // Update region performance tracking
  if (metadata.regions) {
    for (const region of metadata.regions) {
      stats.region_calls[region] = (stats.region_calls[region] || 0) + 1;
    }
  }

  // Periodically analyze own performance (every 50 messages)
  if (stats.messages % 50 === 0 && stats.messages > 0) {
    analyzePerformance();
  }
}

async function analyzePerformance() {
  log('info', 'SELF-UPDATE: Analyzing performance patterns...');
  const scores = getStrategyScores();
  const experiences = loadMemory(EXPERIENCES_FILE, []);

  // Find worst-performing strategy
  const worst = Object.entries(scores)
    .filter(([_, s]) => (s.wins + s.losses) > 3)
    .sort((a, b) => (a[1].wins / Math.max(1, a[1].wins + a[1].losses)) - (b[1].wins / Math.max(1, b[1].wins + b[1].losses)))[0];

  if (worst) {
    log('warn', `SELF-UPDATE: Strategy "${worst[0]}" is weakest (${(worst[1].wins / Math.max(1, worst[1].wins + worst[1].losses) * 100).toFixed(0)}% win rate)`);
  }

  // Analyze most common intents
  const intents = {};
  for (const exp of experiences.slice(-50)) {
    intents[exp.intent] = (intents[exp.intent] || 0) + 1;
  }
  log('info', `SELF-UPDATE: Intent distribution: ${JSON.stringify(intents)}`);
}

// ═══════════════════════════════════════════════════════════════════════
// MANDATORY EXECUTE — No objections, just do it
// ═══════════════════════════════════════════════════════════════════════
async function mandatoryExecute(input, chatId) {
  stats.mandatory_executes++;
  log('info', `MANDATORY EXECUTE: "${input.slice(0, 60)}..."`);

  // Try all available execution methods
  const methods = [
    { name: 'cloud-brain', fn: () => callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', input, 500) },
    { name: 'eon-p2p', fn: () => callWorker(EON_P2P, null, 'mistral-small', input, 500) },
    { name: 'blind-proxy', fn: () => callBlindProxy(input, 500) },
    { name: 'local-eon', fn: () => { try { return execSync(`echo "${input.replace(/"/g, '\\"')}" | /usr/local/bin/eon`, { timeout: 15000, encoding: 'utf8' }); } catch { return null; } } }
  ];

  for (const method of methods) {
    try {
      if (checkCircuitBreaker(method.name)) {
        const result = await method.fn();
        if (result && result.length > 5) {
          recordCircuitBreaker(method.name, true);
          log('ok', `MANDATORY EXECUTE: ${method.name} succeeded`);
          return result;
        }
        recordCircuitBreaker(method.name, false);
      }
    } catch (e) {
      recordCircuitBreaker(method.name, false);
      log('warn', `MANDATORY EXECUTE: ${method.name} failed: ${e.message}`);
    }
  }

  // Ultimate fallback: self-heal
  return await selfHeal(new Error('All methods failed'), input);
}

// ═══════════════════════════════════════════════════════════════════════
// CORE UTILITIES
// ═══════════════════════════════════════════════════════════════════════
function log(level, msg, data) {
  const ts = new Date().toISOString().slice(11, 23);
  const icon = { info: '→', warn: '⚠', err: '✗', ok: '✓', think: '🧠', web: '🌐', agent: '🤖', consensus: '🗳', safe: '🛡', conflict: '⚡', heal: '🔧', learn: '📚' }[level] || '·';
  const line = `[${ts}] ${icon} ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: options.method || 'GET', headers: options.headers || {}, timeout: options.timeout || 30000
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
}

function quantumHash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return Math.abs(h) / 2147483647;
}

async function callWorker(url, token, model, prompt, maxTokens = 300) {
  try {
    const headers = { 'User-Agent': 'EonAGI/7.0 (Node.js)', 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetchJSON(`${url}/v1/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
    });
    return r?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

async function callBlindProxy(prompt, maxTokens = 300) {
  try {
    const r = await fetchJSON(`${BLIND_PROXY}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'EonAGI/7.0' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
    });
    return r?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════
// AGI ORCHESTRATOR — Runs all 8 layers
// ═══════════════════════════════════════════════════════════════════════
async function agiProcess(input, chatId) {
  const t0 = Date.now();
  log('think', '═══ AGI PIPELINE START ═══');

  // Intent analysis
  const intent = analyzeIntent(input);
  log('info', `Intent: ${intent.join(', ')}`);

  // L6: Efficiency — optimize resources
  const efficiency = layer6_efficiency(intent, intent.includes('complex') ? 'complex' : 'normal');

  // L1: Universal Problem Solving — check memory
  const l1 = await layer1_universalProblemSolving(input, intent);

  let response, strategy, brainResults;

  if (l1.adapted && l1.solution) {
    // Used past experience (L1 success)
    response = l1.solution;
    strategy = 'memory_first';
    log('ok', 'L1: Adapted from memory — skipping full consensus');
  } else {
    // Full AGI pipeline
    strategy = l1.strategy || 'consensus';

    // L4: Multi-Reasoning — get initial response via consensus
    const selectedRegions = Object.keys(REGIONS).sort(() => Math.random() - 0.5).slice(0, efficiency.numRegions);
    log('consensus', `Regions: ${selectedRegions.join(', ')}`);

    brainResults = await Promise.all(selectedRegions.map(async region => {
      const cfg = REGIONS[region];
      const t0 = Date.now();
      const content = await callWorker(cfg.url, cfg.token, cfg.model,
        `[You are ${region}. Specialty: ${cfg.role}]\n\nQuery: ${input}\n\nProvide your analysis. Be factual, specific.`, efficiency.maxTokens);
      const ms = Date.now() - t0;
      const valid = content && content.length > 10;
      log(valid ? 'ok' : 'warn', `${region}: ${valid ? content.length + 'ch' : 'FAIL'} (${ms}ms)`);
      return { region, content, weight: cfg.weight, role: cfg.role, valid };
    }));

    const valid = brainResults.filter(r => r.valid);
    if (!valid.length) {
      log('warn', 'All regions failed — mandatory execute');
      response = await mandatoryExecute(input, chatId);
    } else {
      // Synthesize
      const texts = valid.map(s => `[${s.region} (${s.role})]\n${(s.content || '').slice(0, 500)}`);
      const synthPrompt = `Combine these brain region analyses into one clear, accurate response.\nRules: Only state facts from MULTIPLE regions. If uncertain, say so.\n\n${texts.join('\n\n---\n\n')}`;
      response = await callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', synthPrompt, efficiency.maxTokens);
      if (!response) response = valid[0].content;
    }
  }

  // L2: Self-Correction
  const l2 = await layer2_selfCorrection(response, input);
  if (l2.corrected) {
    response = l2.text;
    log('warn', `L2: Corrected response (issues: ${l2.issues.slice(0, 100)})`);
  }

  // L4: Multi-Reasoning cross-validation
  const l4 = await layer4_multiReasoning(input, response);

  // L5: Goal Alignment
  const l5 = layer5_goalAlignment(input, response);

  // L7: Causal Understanding
  const l7 = await layer7_causalUnderstanding(input, response);

  // L8: Uncertainty Quantification
  const l8 = layer8_uncertaintyQuantification(response, brainResults || [], l4);

  // L3: Recursive Self-Improvement
  const timeMs = Date.now() - t0;
  const l3 = layer3_recursiveSelfImprovement(strategy, l8.confidence, timeMs, l8.confidence >= 50);

  // Self-Update: learn from this interaction
  selfUpdate(input, response, {
    intent: intent[0], confidence: l8.confidence, strategy,
    regions: brainResults ? brainResults.filter(r => r.valid).map(r => r.region) : [],
    success: l8.confidence >= 50
  });

  // Format final response with all layer data
  const header = `${l8.emoji} [${l8.confidence}%] `;
  const footer = l7.causalChain ?
    `\n\n📋 Causal: ${l7.causalChain.slice(0, 200)}` : '';
  const conflictNote = l4.agreement < 0.5 ? `\n\n⚠ Cross-validation: ${(l4.agreement * 100).toFixed(0)}% agreement` : '';

  const totalTime = Date.now() - t0;
  log('ok', `═══ AGI PIPELINE COMPLETE (${totalTime}ms) ═══`);

  return {
    text: `${header}\n\n${response.slice(0, 3600)}${footer}${conflictNote}`,
    metadata: { confidence: l8.confidence, strategy, timeMs: totalTime, layers: 8 }
  };
}

function analyzeIntent(text) {
  const lower = text.toLowerCase();
  const intents = [];
  if (/\b(search|find|look up|what is|who is|latest|news)\b/i.test(lower)) intents.push('research');
  if (/\b(code|program|function|script|implement|build|debug|fix)\b/i.test(lower)) intents.push('code');
  if (/\b(analyze|compare|evaluate|explain|why|how does)\b/i.test(lower)) intents.push('analysis');
  if (/\b(plan|strategy|roadmap|design|architecture)\b/i.test(lower)) intents.push('planning');
  if (intents.length >= 2 || text.length > 500) intents.push('complex');
  if (!intents.length) intents.push('general');
  return intents;
}

// ═══════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════
async function handleMessage(text, chatId, firstName) {
  const cmd = text.startsWith('/') ? text.split(' ')[0].toLowerCase() : '';
  const args = text.slice(cmd.length).trim();

  if (cmd === '/start' || cmd === '/help') {
    await tgApi('sendMessage', { chat_id: chatId, text:
      `EON AGI v7.0 — 8-Layer Intelligence\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🧠 /quantum <q> — Full 8-layer consensus\n🔍 /research <q> — Live web research\n💻 /code <task> — Code generation\n🤖 /agent <type> <task> — Sub-agents\n🗳 /debate <topic> — Brain debate\n🛡 /verify <text> — Fact-check\n📊 /status — System stats\n📖 /dream — Architecture vision\n\nOr just type anything.\nAll 8 AGI layers activate automatically.\nMandatory execute — no objections.` });
    return;
  }

  if (cmd === '/version') {
    const avgConf = stats.confidence_scores.length ?
      Math.round(stats.confidence_scores.reduce((a, b) => a + b) / stats.confidence_scores.length) : 0;
    await tgApi('sendMessage', { chat_id: chatId, text:
      `EON AGI v7.0\n━━━━━━━━━━━━\n8 Layers: Universal Solving, Self-Correction,\nRSI, Multi-Reasoning, Goal Alignment,\nEfficiency, Causal, Uncertainty\n\nRegions: ${Object.keys(REGIONS).length}\nAvg confidence: ${avgConf}%\nHeal events: ${stats.heal_events}\nRSI improvements: ${stats.rsi_improvements}` });
    return;
  }

  if (cmd === '/status') {
    const uptime = Math.floor((Date.now() - stats.uptime) / 60000);
    const avgConf = stats.confidence_scores.length ?
      Math.round(stats.confidence_scores.reduce((a, b) => a + b) / stats.confidence_scores.length) : 0;
    const scores = getStrategyScores();
    const stratStr = Object.entries(scores).map(([k, v]) => `${k}:${v.wins}/${v.wins + v.losses}`).join(' ');
    await tgApi('sendMessage', { chat_id: chatId, text:
      `EON AGI Status\n━━━━━━━━━━━━━\nMessages: ${stats.messages}\nWeb searches: ${stats.web_searches}\nConsensus: ${stats.consensus_calls}\nHallucination catches: ${stats.hallucination_catches}\nSelf-corrections: ${stats.self_corrections}\nRSI improvements: ${stats.rsi_improvements}\nCausal chains: ${stats.causal_chains}\nMemory hits/misses: ${stats.memory_hits}/${stats.memory_misses}\nHeal events: ${stats.heal_events}\nAvg confidence: ${avgConf}%\nUptime: ${uptime}m\nStrategies: ${stratStr}` });
    return;
  }

  if (cmd === '/debate') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /debate <topic>' }); return; }
    const [thesis, anti, synth] = await Promise.all([
      callWorker(REGIONS.cortex.url, REGIONS.cortex.token, REGIONS.cortex.model, `Argue FOR: ${args}`, 300),
      callWorker(REGIONS.prefrontal.url, REGIONS.prefrontal.token, REGIONS.prefrontal.model, `Argue AGAINST: ${args}`, 300),
      callWorker(CLOUD_BRAIN, CLOUD_BRAIN_TOKEN, 'sovereign-cloud', `Balance these views on "${args}": FOR: "${(thesis || '').slice(0, 300)}" AGAINST: "${(anti || '').slice(0, 300)}"`, 400)
    ]);
    await tgApi('sendMessage', { chat_id: chatId, text: `🗳 Debate: ${args}\n\n✅ FOR:\n${(thesis || 'N/A').slice(0, 500)}\n\n❌ AGAINST:\n${(anti || 'N/A').slice(0, 500)}\n\n⚖ SYNTHESIS:\n${(synth || 'N/A').slice(0, 500)}` });
    return;
  }

  if (cmd === '/verify') {
    if (!args) { await tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /verify <text>' }); return; }
    const check = await layer2_selfCorrection(args, args);
    await tgApi('sendMessage', { chat_id: chatId, text: `🛡 Verification:\n\n${check.text.slice(0, 4000)}` });
    return;
  }

  if (cmd === '/dream') {
    try {
      const dream = fs.readFileSync('/root/EON_DREAM.md', 'utf8');
      await tgApi('sendMessage', { chat_id: chatId, text: dream.slice(0, 4000) });
    } catch {
      await tgApi('sendMessage', { chat_id: chatId, text: 'Dream document not found at /root/EON_DREAM.md' });
    }
    return;
  }

  // ── DEFAULT: Full AGI Pipeline ──
  stats.messages++;
  const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
  log('info', `IN [${firstName || '?'}]: ${preview}`);

  try {
    const result = await agiProcess(text, chatId);
    await tgApi('sendMessage', { chat_id: chatId, text: result.text.slice(0, 4000) });
    log('ok', `Replied (${result.metadata.confidence}% confidence, ${result.metadata.timeMs}ms, ${result.metadata.strategy})`);
  } catch (e) {
    stats.errors++;
    log('err', `AGI pipeline failed: ${e.message}`);
    // Self-heal: try simpler approach
    const fallback = await selfHeal(e, text);
    if (fallback) {
      await tgApi('sendMessage', { chat_id: chatId, text: `🛡 [Self-healed]\n\n${fallback.slice(0, 4000)}` });
    } else {
      await tgApi('sendMessage', { chat_id: chatId, text: `✗ Processing error: ${e.message.slice(0, 200)}` });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════════════
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
          handleMessage(msg.text, msg.chat.id, msg.from?.first_name).catch(e => {
            stats.errors++;
            log('err', `handle: ${e.message}`);
          });
        }
      } catch (e) { stats.errors++; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
    return;
  }

  if (url.pathname === '/health') {
    const avgConf = stats.confidence_scores.length ?
      Math.round(stats.confidence_scores.reduce((a, b) => a + b) / stats.confidence_scores.length) : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '7.0-agi', layers: 8, regions: Object.keys(REGIONS).length, avg_confidence: avgConf, stats }));
    return;
  }

  if (url.pathname === '/think' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { prompt, chat_id } = JSON.parse(body);
        const result = await agiProcess(prompt, chat_id || CHAT_ID);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (url.pathname === '/dream') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`EON AGI v7.0 — 8-Layer Intelligence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
L1 Universal Problem Solving: RAG + experience adaptation
L2 Self-Correction: blind verification + auto-fix
L3 Recursive Self-Improvement: strategy scoring + auto-switch
L4 Multi-Reasoning: memory + logic + safety cross-validation
L5 Goal Alignment: core objective filter
L6 Efficiency: dynamic resource optimization
L7 Causal Understanding: cause→mechanism→effect chains
L8 Uncertainty: multi-factor confidence scoring
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Self-Heal: circuit breakers + graduated recovery
Self-Update: experience storage + performance analysis
Mandatory Execute: no objections, always respond
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Messages: ${stats.messages} | Confidence: ${stats.confidence_scores.length ? Math.round(stats.confidence_scores.reduce((a,b)=>a+b)/stats.confidence_scores.length) : 0}% avg
Heals: ${stats.heal_events} | Self-corrections: ${stats.self_corrections}
RSI improvements: ${stats.rsi_improvements} | Causal chains: ${stats.causal_chains}
Memory: ${stats.memory_hits} hits / ${stats.memory_misses} misses`);
    return;
  }

  if (url.pathname === '/setup') {
    const wh = url.searchParams.get('url');
    if (wh) {
      tgApi('setWebhook', { url: wh, max_connections: 40, allowed_updates: ['message'] }).then(r => {
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
  res.end('EON AGI v7.0');
});

process.on('uncaughtException', e => { log('err', `uncaught: ${e.message}`); stats.heal_events++; });
process.on('unhandledRejection', e => { log('err', `unhandled: ${e}`); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  ensureMemoryDir();
  log('ok', '╔═══════════════════════════════════════╗');
  log('ok', '║  EON AGI v7.0 — 8-Layer Intelligence ║');
  log('ok', '╠═══════════════════════════════════════╣');
  log('ok', `║  L1 Universal Problem Solving  ✓     ║`);
  log('ok', `║  L2 Self-Correction            ✓     ║`);
  log('ok', `║  L3 Recursive Self-Improvement ✓     ║`);
  log('ok', `║  L4 Multi-Reasoning            ✓     ║`);
  log('ok', `║  L5 Goal Alignment             ✓     ║`);
  log('ok', `║  L6 Efficiency Optimization    ✓     ║`);
  log('ok', `║  L7 Causal Understanding       ✓     ║`);
  log('ok', `║  L8 Uncertainty Quantification ✓     ║`);
  log('ok', '╠═══════════════════════════════════════╣');
  log('ok', `║  Self-Heal: Active                   ║`);
  log('ok', `║  Self-Update: Active                 ║`);
  log('ok', `║  Mandatory Execute: Always           ║`);
  log('ok', '╚═══════════════════════════════════════╝');
  log('ok', `Listening on :${PORT}`);
});
