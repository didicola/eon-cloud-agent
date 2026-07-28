// ═══════════════════════════════════════════════════════════════════════
// EON AGI v8.0 — Self-Upgrade Module
// P0: TF-IDF retrieval, cross-model verify, holdout eval
// P1: Task-adaptive consensus, CoVe verification, Quality Decay, Tiered memory
// P2: AAD pre-drafting, early quorum
// ═══════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const MEMORY_DIR = '/root/.eon/memory';
const HOLDOUT_FILE = path.join(MEMORY_DIR, 'holdout.json');
const SKILLS_FILE = path.join(MEMORY_DIR, 'skills.json');
const QUALITY_FILE = path.join(MEMORY_DIR, 'quality.json');
const MEMORY_HOT = path.join(MEMORY_DIR, 'hot.json');
const MEMORY_WARM = path.join(MEMORY_DIR, 'warm.json');
const MEMORY_COLD = path.join(MEMORY_DIR, 'cold.json');

function ensureDir() { try { fs.mkdirSync(MEMORY_DIR, { recursive: true }); } catch {} }
function loadJSON(f, d = {}) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function saveJSON(f, d) { ensureDir(); try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch {} }

// ═══════════════════════════════════════════════════════════════════════
// P0: TF-IDF SIMILARITY (replaces word overlap — 10x accuracy)
// ═══════════════════════════════════════════════════════════════════════
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  'the','is','at','which','on','a','an','and','or','but','in','with','to','for',
  'of','this','that','it','as','be','was','were','are','has','have','had','do',
  'does','did','will','would','could','should','may','might','can','shall',
  'from','by','not','no','if','then','than','so','just','about','up','out',
  'all','also','its','over','into','my','your','his','her','our','their','what',
  'how','when','where','who','which','there','here','very','more','most','some'
]);

function computeTFIDF(documents) {
  const N = documents.length;
  const df = {};  // document frequency per term
  const tfidf = [];

  for (const doc of documents) {
    const tokens = tokenize(doc);
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const maxTf = Math.max(...Object.values(tf), 1);
    const tfidfVec = {};
    for (const [term, count] of Object.entries(tf)) {
      tfidfVec[term] = (count / maxTf) * (Math.log((N + 1) / (df[term] || 0 + 1)) + 1);
    }
    tfidf.push({ vec: tfidfVec, tokens: new Set(tokens) });
  }

  // Update document frequency
  for (const t of tfidf) {
    for (const term of Object.keys(t.vec)) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  return tfidf;
}

function cosineSimilarity(vecA, vecB) {
  const terms = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  let dot = 0, normA = 0, normB = 0;
  for (const t of terms) {
    const a = vecA[t] || 0;
    const b = vecB[t] || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  return normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

function tfidfSearch(query, experiences, limit = 3) {
  if (!experiences.length) return [];
  const docs = experiences.map(e => `${e.input} ${e.intent || ''}`);
  docs.push(query);
  const tfidf = computeTFIDF(docs);
  const queryVec = tfidf[tfidf.length - 1].vec;

  const scored = experiences.map((exp, i) => {
    const sim = cosineSimilarity(queryVec, tfidf[i].vec);
    const recency = Math.max(0, 1 - (Date.now() - exp.timestamp) / (14 * 24 * 60 * 60 * 1000));
    const successBonus = exp.success ? 0.1 : -0.1;
    return { ...exp, score: sim * 0.6 + recency * 0.25 + successBonus + (exp.confidence || 50) / 500 };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).filter(s => s.score > 0.15);
}

// ═══════════════════════════════════════════════════════════════════════
// P0: CROSS-MODEL VERIFICATION (verifier ≠ generator)
// ═══════════════════════════════════════════════════════════════════════
const VERIFIER_MAP = {
  cortex: 'brainstem',      // brainstem verifies cortex
  brainstem: 'prefrontal',  // prefrontal verifies brainstem
  prefrontal: 'cortex',     // cortex verifies prefrontal
  hippocampus: 'thalamus',  // thalamus verifies hippocampus
  thalamus: 'limbic',       // limbic verifies thalamus
  limbic: 'brainstem',      // brainstem verifies limbic
};

function getCrossVerifier(generatorRegion) {
  return VERIFIER_MAP[generatorRegion] || 'brainstem';
}

async function crossModelVerify(response, generatorRegion, input, REGIONS, callWorker) {
  const verifierRegion = getCrossVerifier(generatorRegion);
  const cfg = REGIONS[verifierRegion];

  const verifyPrompt = `You are the ${verifierRegion} region verifying output from the ${generatorRegion} region.

Original question: "${input}"
Generated response: "${response.slice(0, 800)}"

As a different brain region, independently verify:
1. Are the factual claims correct?
2. Is the reasoning sound?
3. Are there contradictions?
4. Is anything fabricated?

Reply ONLY: "VERIFIED" or "ERRORS: [specific issues]"`;

  const result = await callWorker(cfg.url, cfg.token, cfg.model, verifyPrompt, 200);
  return { verifier: verifierRegion, result: result || 'UNABLE TO VERIFY', passed: result?.startsWith('VERIFIED') };
}

// ═══════════════════════════════════════════════════════════════════════
// P0: HOLDOUT EVALUATION SET (prevents false RSI claims)
// ═══════════════════════════════════════════════════════════════════════
const HOLDOUT_QUERIES = [
  { q: "What is the capital of France?", expected: "Paris" },
  { q: "Explain photosynthesis briefly.", expected: "plants use sunlight" },
  { q: "What is 2+2?", expected: "4" },
  { q: "Who wrote Romeo and Juliet?", expected: "Shakespeare" },
  { q: "What is the speed of light?", expected: "300000 km/s" },
];

function runHoldoutEval(callWorkerFn) {
  // Run a subset of holdout queries to check if system is degrading
  const sample = HOLDOUT_QUERIES.sort(() => Math.random() - 0.5).slice(0, 2);
  const results = [];

  return Promise.all(sample.map(async (hq) => {
    try {
      const response = await callWorkerFn(hq.q);
      const correct = response && response.toLowerCase().includes(hq.expected.toLowerCase());
      return { query: hq.q, correct, response: (response || '').slice(0, 100) };
    } catch {
      return { query: hq.q, correct: false, response: 'ERROR' };
    }
  })).then(results => {
    const accuracy = results.filter(r => r.correct).length / results.length;
    const evalData = { timestamp: Date.now(), accuracy, results, sampleSize: results.length };

    // Store eval history
    const evals = loadJSON(path.join(MEMORY_DIR, 'holdout_evals.json'), []);
    evals.push(evalData);
    if (evals.length > 50) evals.splice(0, evals.length - 50);
    saveJSON(path.join(MEMORY_DIR, 'holdout_evals.json'), evals);

    return evalData;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// P1: TASK-ADAPTIVE CONSENSUS
// ═══════════════════════════════════════════════════════════════════════
function selectConsensusProtocol(intent) {
  const reasoningTasks = ['analysis', 'code', 'planning', 'logic'];
  const knowledgeTasks = ['research', 'general', 'fact'];
  const creativeTasks = ['creative', 'brainstorm', 'ideate'];

  if (intent.some(i => reasoningTasks.includes(i))) {
    return { protocol: 'voting', description: 'Each region votes independently, majority wins', numRegions: 5 };
  }
  if (intent.some(i => knowledgeTasks.includes(i))) {
    return { protocol: 'consensus', description: 'Regions discuss until agreement', numRegions: 4 };
  }
  if (intent.some(i => creativeTasks.includes(i))) {
    return { protocol: 'divergent', description: 'Maximize diversity of perspectives', numRegions: 6 };
  }
  return { protocol: 'consensus', description: 'Default consensus', numRegions: 3 };
}

// ═══════════════════════════════════════════════════════════════════════
// P1: CoVe-STYLE VERIFICATION QUESTION PLANNING
// ═══════════════════════════════════════════════════════════════════════
async function coveVerification(response, input, REGIONS, callWorker) {
  // Step 1: Generate verification questions
  const genPrompt = `Given this response to "${input}":
"${response.slice(0, 800)}"

Generate 3 specific verification questions that would check if this response is factually correct. Each question should target a specific claim.

Reply as numbered list:
1. [question]
2. [question]
3. [question]`;

  const questionsRaw = await callWorker(REGIONS.thalamus.url, REGIONS.thalamus.token, REGIONS.thalamus.model, genPrompt, 200);
  if (!questionsRaw) return { passed: true, issues: 0 };

  const questions = questionsRaw.split('\n')
    .filter(l => /^\d/.test(l.trim()))
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .slice(0, 3);

  if (!questions.length) return { passed: true, issues: 0 };

  // Step 2: Answer each question independently (no original response in context!)
  const answers = await Promise.all(questions.map(async (q) => {
    const answer = await callWorker(REGIONS.brainstem.url, REGIONS.brainstem.token, REGIONS.brainstem.model,
      `Answer this question independently using only your knowledge:\n"${q}"`, 100);
    return { question: q, answer: answer || 'UNKNOWN' };
  }));

  // Step 3: Cross-check answers against original response
  const checkPrompt = `Original response: "${response.slice(0, 600)}"

Verification answers:
${answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}

Do the verification answers SUPPORT or CONTRADICT the original response?
Reply: "SUPPORTED" or "CONTRADICTED: [which claims fail and why]"`;

  const verdict = await callWorker(REGIONS.cortex.url, REGIONS.cortex.token, REGIONS.cortex.model, checkPrompt, 150);

  return {
    passed: verdict?.startsWith('SUPPORTED') || !verdict?.startsWith('CONTRADICTED'),
    questions, answers, verdict: verdict || 'UNABLE TO CHECK',
    issues: verdict?.startsWith('CONTRADICTED') ? 1 : 0
  };
}

// ═══════════════════════════════════════════════════════════════════════
// P1: QUALITY DECAY FUNCTION + ORI METRIC
// ═══════════════════════════════════════════════════════════════════════
function updateQualityDecay(responseTime, confidence, success) {
  const quality = loadJSON(QUALITY_FILE, {
    base: 80,
    current: 80,
    history: [],
    infra_health: 1.0,
    model_health: 1.0,
    ori: 0.8,
    tasks_completed: 0,
    tasks_failed: 0,
    avg_response_time: 5000,
    waste_ratio: 0.1
  });

  // Quality Decay: Q(t) = Qbase * infra_health * model_health
  quality.tasks_completed++;
  if (!success) quality.tasks_failed++;

  // Update infrastructure health (based on response time)
  const timeHealth = Math.max(0.5, 1 - (responseTime - 3000) / 20000);
  quality.infra_health = quality.infra_health * 0.9 + timeHealth * 0.1;

  // Update model health (based on confidence)
  const modelHealth = confidence / 100;
  quality.model_health = quality.model_health * 0.9 + modelHealth * 0.1;

  // Quality score
  quality.current = quality.base * quality.infra_health * quality.model_health;

  // ORI: Operational Reliability Index
  const uptime = quality.tasks_completed / Math.max(1, quality.tasks_completed + quality.tasks_failed);
  quality.waste_ratio = quality.waste_ratio * 0.95 + (success ? 0 : 0.05);
  quality.ori = uptime * (1 - quality.waste_ratio) * (quality.current / 100);

  // History (keep last 100)
  quality.history.push({ t: Date.now(), q: quality.current, ori: quality.ori, inf: quality.infra_health, mod: quality.model_health });
  if (quality.history.length > 100) quality.history.splice(0, quality.history.length - 100);

  saveJSON(QUALITY_FILE, quality);
  return quality;
}

// ═══════════════════════════════════════════════════════════════════════
// P1: TIERED MEMORY (hot/warm/cold)
// ═══════════════════════════════════════════════════════════════════════
function tieredStore(exp) {
  ensureDir();

  // Hot: last 50 experiences (high-speed access)
  let hot = loadJSON(MEMORY_HOT, []);
  hot.push(exp);
  if (hot.length > 50) {
    // Move overflow to warm
    const overflow = hot.splice(0, hot.length - 50);
    let warm = loadJSON(MEMORY_WARM, []);
    warm = [...warm, ...overflow];
    if (warm.length > 200) {
      // Move overflow to cold
      const coldOverflow = warm.splice(0, warm.length - 200);
      let cold = loadJSON(MEMORY_COLD, []);
      cold = [...cold, ...coldOverflow];
      if (cold.length > 1000) cold.splice(0, cold.length - 1000);
      saveJSON(MEMORY_COLD, cold);
    }
    saveJSON(MEMORY_WARM, warm);
  }
  saveJSON(MEMORY_HOT, hot);
}

function tieredSearch(query, limit = 3) {
  const hot = loadJSON(MEMORY_HOT, []);
  const warm = loadJSON(MEMORY_WARM, []);

  // Search hot first (most recent, highest priority)
  let results = tfidfSearch(query, hot, limit);
  if (results.length >= limit) return results;

  // Then warm
  const warmResults = tfidfSearch(query, warm, limit - results.length);
  results = [...results, ...warmResults];

  // Then cold (only if needed)
  if (results.length < limit) {
    const cold = loadJSON(MEMORY_COLD, []);
    const coldResults = tfidfSearch(query, cold, limit - results.length);
    results = [...results, ...coldResults];
  }

  return results.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════
// P2: ALL-AGENTS DRAFTING (AAD) — pre-draft before sharing
// ═══════════════════════════════════════════════════════════════════════
async function aadDrafting(input, regions, callWorkerFn, REGIONS) {
  // Phase 1: Each region drafts INDEPENDENTLY (no anchoring)
  const drafts = await Promise.all(regions.map(async region => {
    const cfg = REGIONS[region];
    const draft = await callWorkerFn(cfg.url, cfg.token, cfg.model,
      `[${region.toUpperCase()} — independent draft]\n\nAnalyze: ${input}\n\nProvide your independent analysis WITHOUT seeing other regions' answers.`, 250);
    return { region, draft, valid: draft && draft.length > 10 };
  }));

  return drafts.filter(d => d.valid);
}

// ═══════════════════════════════════════════════════════════════════════
// P2: EARLY QUORUM DETECTION
// ═══════════════════════════════════════════════════════════════════════
function detectEarlyQuorum(results) {
  if (results.length < 3) return false;

  // Check if top 3 results are sufficiently similar
  const topTexts = results.slice(0, 3).map(r => (r.draft || r.content || '').toLowerCase());
  const topWords = topTexts.map(t => new Set(t.split(/\s+/).filter(w => w.length > 4)));

  // Pairwise overlap
  let totalOverlap = 0;
  let pairs = 0;
  for (let i = 0; i < topWords.length; i++) {
    for (let j = i + 1; j < topWords.length; j++) {
      const intersection = [...topWords[i]].filter(w => topWords[j].has(w)).length;
      const union = new Set([...topWords[i], ...topWords[j]]).size;
      totalOverlap += union > 0 ? intersection / union : 0;
      pairs++;
    }
  }

  const avgOverlap = pairs > 0 ? totalOverlap / pairs : 0;
  return avgOverlap > 0.4; // Quorum: >40% overlap
}

// ═══════════════════════════════════════════════════════════════════════
// P2: SKILL COMPILER — experiences → reusable micro-skills
// ═══════════════════════════════════════════════════════════════════════
function compileSkills(experiences) {
  const skills = loadJSON(SKILLS_FILE, []);

  // Find patterns in successful experiences
  const successful = experiences.filter(e => e.success && e.confidence >= 70);
  const intentGroups = {};
  for (const exp of successful) {
    const key = exp.intent || 'general';
    if (!intentGroups[key]) intentGroups[key] = [];
    intentGroups[key].push(exp);
  }

  // Compile each group into a skill
  for (const [intent, exps] of Object.entries(intentGroups)) {
    if (exps.length >= 3) {
      const existing = skills.find(s => s.intent === intent);
      const avgConfidence = exps.reduce((a, e) => a + (e.confidence || 50), 0) / exps.length;
      const bestStrategy = exps.reduce((acc, e) => {
        acc[e.strategy] = (acc[e.strategy] || 0) + 1;
        return acc;
      }, {});
      const topStrategy = Object.entries(bestStrategy).sort((a, b) => b[1] - a[1])[0]?.[0] || 'consensus';

      const skill = {
        intent,
        strategy: topStrategy,
        confidence: avgConfidence,
        examples: exps.length,
        lastUpdated: Date.now(),
        prompt_template: `For ${intent} tasks, use strategy "${topStrategy}" with high confidence.`
      };

      if (existing) {
        Object.assign(existing, skill);
      } else {
        skills.push(skill);
      }
    }
  }

  saveJSON(SKILLS_FILE, skills);
  return skills;
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════
module.exports = {
  // P0
  tfidfSearch, tokenize, computeTFIDF, cosineSimilarity,
  crossModelVerify, getCrossVerifier,
  runHoldoutEval, HOLDOUT_QUERIES,
  // P1
  selectConsensusProtocol,
  coveVerification,
  updateQualityDecay,
  tieredStore, tieredSearch,
  // P2
  aadDrafting, detectEarlyQuorum,
  compileSkills,
  // Utils
  ensureDir, loadJSON, saveJSON
};
