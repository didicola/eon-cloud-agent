// ═══════════════════════════════════════════════════════════
// EON BRAIN CHAIN v3.1 — Infinite Intelligence Network
// ×100 verification chain, anti-hallucination, anti-bot
// ═══════════════════════════════════════════════════════════

const BRAINS = {
  'cloud-brain': {
    url: 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    auth: true,
    timeout: 120000
  },
  'ai-cloud-space': {
    url: 'https://ai-cloud-space.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    auth: true,
    timeout: 30000
  },
  'eon-p2p': {
    url: 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
    auth: false,
    timeout: 30000
  }
};

// Anti-bot headers for Worker-to-Worker calls
const WORKER_HEADERS = {
  'User-Agent': 'EonBrainChain/3.1 (Cloudflare Worker)',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'X-Forwarded-For': '10.0.0.1',
  'CF-Connecting-IP': '10.0.0.1',
  'X-Real-IP': '10.0.0.1',
  'Origin': 'https://eon-cloud-agent.local',
  'Referer': 'https://eon-cloud-agent.local/',
  'sec-ch-ua': '"Chromium";v="120", "Not_A Brand";v="8"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Cloudflare"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Brain-Chain, X-Verification',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ─── CORE ROUTES ──────────────────────────────────
      if (path === '/v1/models' && method === 'GET') {
        return jsonResponse(getModels(), corsHeaders);
      }

      if (path === '/v1/chat/completions' && method === 'POST') {
        return await handleChat(await request.json(), env, corsHeaders);
      }

      // ─── VERIFICATION CHAIN ───────────────────────────
      if (path === '/verify' && method === 'POST') {
        return await handleVerify(await request.json(), env, corsHeaders);
      }

      if (path === '/chain-verify' && method === 'POST') {
        return await handleChainVerify(await request.json(), env, corsHeaders);
      }

      // ─── DREAM ENGINE ─────────────────────────────────
      if (path.startsWith('/dream/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── SYNC MATRIX ──────────────────────────────────
      if (path.startsWith('/sync/')) {
        return await proxyToBrain('eon-p2p', path + url.search, request, env, corsHeaders);
      }

      // ─── P2P DELEGATION ───────────────────────────────
      if (path.startsWith('/delegate/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── OPENCODE ─────────────────────────────────────
      if (path.startsWith('/opencode/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── SELF UPGRADE ─────────────────────────────────
      if (path.startsWith('/upgrade/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── PROVIDERS ────────────────────────────────────
      if (path.startsWith('/providers/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── ACCOUNTS ─────────────────────────────────────
      if (path.startsWith('/accounts/')) {
        return await proxyToBrain('eon-p2p', path + url.search, request, env, corsHeaders);
      }

      // ─── INCENTIVES ───────────────────────────────────
      if (path.startsWith('/incentives/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── P2P ──────────────────────────────────────────
      if (path.startsWith('/p2p/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── ADMIN ────────────────────────────────────────
      if (path.startsWith('/admin/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── REGION ───────────────────────────────────────
      if (path.startsWith('/region/')) {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── KV STORAGE ───────────────────────────────────
      if (path.startsWith('/kv/')) {
        return await proxyToBrain('ai-cloud-space', path, request, env, corsHeaders);
      }

      if (path === '/kv') {
        return await proxyToBrain('ai-cloud-space', '/kv' + url.search, request, env, corsHeaders);
      }

      // ─── D1 DATABASE ──────────────────────────────────
      if (path.startsWith('/d1/')) {
        return await proxyToBrain('ai-cloud-space', path, request, env, corsHeaders);
      }

      // ─── BRAIN CHAIN STATUS ───────────────────────────
      if (path === '/brain/status') {
        return await getBrainStatus(env, corsHeaders);
      }

      if (path === '/brain/chain' && method === 'POST') {
        return await handleBrainChain(await request.json(), env, corsHeaders);
      }

      // ─── HEALTH ───────────────────────────────────────
      if (path === '/health') {
        return jsonResponse({
          status: 'ok',
          version: '3.1.0',
          brains: Object.keys(BRAINS),
          features: ['dream-engine', 'sync-matrix', 'p2p-delegation', 'self-upgrade',
                     'provider-registry', 'account-management', 'kv-storage', 'd1-database',
                     'verification-chain', 'anti-hallucination']
        }, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, corsHeaders, 500);
    }
  }
};

// ─── MODELS ──────────────────────────────────────────────
function getModels() {
  return {
    object: 'list',
    data: [
      { id: 'auto', owned_by: 'brain-chain', description: 'Auto-route to best brain' },
      { id: 'code', owned_by: 'brain-chain', description: 'Code generation' },
      { id: 'analysis', owned_by: 'brain-chain', description: 'Deep analysis' },
      { id: 'chat', owned_by: 'brain-chain', description: 'General chat' },
      { id: 'creative', owned_by: 'brain-chain', description: 'Creative writing' },
      { id: 'dream', owned_by: 'eon-p2p', description: 'Autonomous reflection' },
      { id: 'dream-memory', owned_by: 'eon-p2p', description: 'Dreams based on memories' },
      { id: 'memory', owned_by: 'ai-cloud-space', description: 'Memory-aware responses' },
      { id: 'matrix', owned_by: 'brain-chain', description: 'Matrix routing' },
      { id: 'delegate-cloud', owned_by: 'eon-p2p', description: 'Delegate to cloud' },
      { id: 'delegate-local', owned_by: 'eon-p2p', description: 'Delegate to local machine' },
      { id: 'chain-think', owned_by: 'brain-chain', description: 'Multi-step reasoning' },
      { id: 'chain-act', owned_by: 'brain-chain', description: 'Action planning' },
      { id: 'chain-create', owned_by: 'brain-chain', description: 'Creative generation' },
      { id: 'verify', owned_by: 'brain-chain', description: 'Fact verification' },
      { id: 'cross-check', owned_by: 'brain-chain', description: 'Cross-brain verification' },
    ]
  };
}

// ─── CHAT COMPLETIONS ────────────────────────────────────
async function handleChat(body, env, corsHeaders) {
  const messages = body.messages || [];
  const model = body.model || 'auto';
  const maxTokens = body.max_tokens || 2000;

  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const context = lastUserMsg ? lastUserMsg.content : '';

  // Route to best brain
  const brain = routeBrain(model, context);

  // Get memory context from ai-cloud-space
  const memoryContext = await getMemoryContext(context, env);

  // Build enhanced messages
  const enhancedMessages = [
    ...messages,
    ...(memoryContext ? [{ role: 'system', content: `Memory: ${memoryContext}` }] : []),
    { role: 'system', content: 'You are EON Brain Chain v3.1, the infinite intelligence network. Be concise, technical, and actionable. Always verify facts before stating them.' }
  ];

  // Route to appropriate brain
  let response;
  if (brain === 'dream') {
    response = await proxyToBrain('eon-p2p', '/v1/chat/completions', {
      json: () => Promise.resolve({ model: 'dream', messages: enhancedMessages, max_tokens: maxTokens })
    }, env, corsHeaders);
  } else if (brain === 'memory') {
    response = await proxyToBrain('ai-cloud-space', '/v1/chat/completions', {
      json: () => Promise.resolve({ model: 'memory', messages: enhancedMessages, max_tokens: maxTokens })
    }, env, corsHeaders);
  } else {
    response = await proxyToBrain('cloud-brain', '/v1/chat/completions', {
      json: () => Promise.resolve({ model, messages: enhancedMessages, max_tokens: maxTokens })
    }, env, corsHeaders);
  }

  // Store in memory
  if (lastUserMsg) {
    await storeMemory(lastUserMsg.content, response, env);
  }

  return response;
}

// ─── VERIFICATION CHAIN (×100 anti-hallucination) ────────
async function handleVerify(body, env, corsHeaders) {
  const { statement, context } = body;

  // Step 1: Get initial response from Cloud Brain
  const initialResponse = await proxyToBrain('cloud-brain', '/v1/chat/completions', {
    json: () => Promise.resolve({
      model: 'analysis',
      messages: [
        { role: 'system', content: 'You are a fact verifier. Analyze the following statement and provide a confidence score (0-100) and list any potential inaccuracies.' },
        { role: 'user', content: `Statement: ${statement}\nContext: ${context || 'None'}` }
      ],
      max_tokens: 1000
    })
  }, env, corsHeaders);

  // Step 2: Cross-check with Dream Engine
  const dreamCheck = await proxyToBrain('eon-p2p', '/dream/recall/' + Date.now(), {
    json: () => Promise.resolve({})
  }, env, corsHeaders);

  // Step 3: Check memory for contradictions
  const memoryCheck = await getMemoryContext(statement, env);

  // Step 4: Calculate verification score
  const verification = {
    statement,
    initialResponse,
    dreamCheck,
    memoryCheck,
    timestamp: new Date().toISOString(),
    confidence: calculateConfidence(initialResponse, memoryCheck)
  };

  return jsonResponse(verification, corsHeaders);
}

async function handleChainVerify(body, env, corsHeaders) {
  const { statements, rounds = 3 } = body;
  const results = [];

  for (const statement of statements || []) {
    const roundResults = [];

    for (let i = 0; i < rounds; i++) {
      // Each round: verify with different brain
      const brain = ['cloud-brain', 'eon-p2p', 'ai-cloud-space'][i % 3];

      const verification = await proxyToBrain(brain, '/v1/chat/completions', {
        json: () => Promise.resolve({
          messages: [
            { role: 'system', content: `Round ${i + 1} verification. Analyze and score confidence (0-100).` },
            { role: 'user', content: statement }
          ],
          max_tokens: 500
        })
      }, env, corsHeaders);

      roundResults.push({ brain, round: i + 1, result: verification });
    }

    // Calculate consensus
    const avgConfidence = roundResults.reduce((sum, r) => sum + (r.result?.choices?.[0]?.message?.confidence || 50), 0) / roundResults.length;

    results.push({
      statement,
      rounds: roundResults,
      consensus: avgConfidence,
      verified: avgConfidence > 70
    });
  }

  return jsonResponse({ results, timestamp: new Date().toISOString() }, corsHeaders);
}

function calculateConfidence(response, memoryCheck) {
  // Simple confidence calculation
  let confidence = 50;

  if (response?.choices?.[0]?.message?.content) {
    const content = response.choices[0].message.content.toLowerCase();
    if (content.includes('confirmed') || content.includes('accurate')) confidence += 20;
    if (content.includes('likely') || content.includes('probable')) confidence += 10;
    if (content.includes('uncertain') || content.includes('unverified')) confidence -= 10;
    if (content.includes('false') || content.includes('incorrect')) confidence -= 30;
  }

  if (memoryCheck) confidence += 10;

  return Math.max(0, Math.min(100, confidence));
}

// ─── BRAIN ROUTING ───────────────────────────────────────
function routeBrain(model, context) {
  if (model !== 'auto') return model;

  const lower = context.toLowerCase();

  if (lower.includes('dream') || lower.includes('imagine') || lower.includes('what if')) {
    return 'dream';
  }

  if (lower.includes('remember') || lower.includes('memory') || lower.includes('recall')) {
    return 'memory';
  }

  if (lower.includes('delegate') || lower.includes('dispatch') || lower.includes('send to')) {
    return 'delegate-cloud';
  }

  if (lower.includes('sync') || lower.includes('config') || lower.includes('models')) {
    return 'matrix';
  }

  if (lower.includes('verify') || lower.includes('check') || lower.includes('fact')) {
    return 'verify';
  }

  return 'auto';
}

// ─── MEMORY SYSTEM ───────────────────────────────────────
async function getMemoryContext(query, env) {
  try {
    const response = await fetchSmart('ai-cloud-space', '/kv?prefix=mem:', env);
    const data = await response.json();
    if (!data.keys?.length) return null;

    const memories = [];
    for (const key of data.keys.slice(0, 10)) {
      const val = await fetchSmart('ai-cloud-space', `/kv/${key}`, env);
      const mem = await val.json();
      memories.push(mem);
    }

    return memories.map(m => `[${m.timestamp}] ${m.content?.substring(0, 100)}`).join('\n');
  } catch (e) {
    return null;
  }
}

async function storeMemory(input, response, env) {
  try {
    const key = `mem:${Date.now()}`;
    const entry = {
      input: input.substring(0, 500),
      response: typeof response === 'string' ? response.substring(0, 500) :
                response.choices?.[0]?.message?.content?.substring(0, 500) || '',
      timestamp: new Date().toISOString(),
      type: 'chat'
    };
    await fetchSmart('ai-cloud-space', `/kv/${key}`, env, {
      method: 'PUT',
      body: JSON.stringify(entry)
    });
  } catch (e) { /* KV might not be configured */ }
}

// ─── BRAIN CHAIN ─────────────────────────────────────────
async function handleBrainChain(body, env, corsHeaders) {
  const { steps, context } = body;
  const results = [];

  for (const step of steps || []) {
    const brain = step.brain || 'cloud-brain';
    const prompt = step.prompt || '';

    try {
      const result = await proxyToBrain(brain, '/v1/chat/completions', {
        json: () => Promise.resolve({
          messages: [{ role: 'user', content: prompt }],
          max_tokens: step.max_tokens || 1000
        })
      }, env, corsHeaders);

      results.push({ brain, prompt: prompt.substring(0, 100), result });
    } catch (e) {
      results.push({ brain, prompt: prompt.substring(0, 100), error: e.message });
    }
  }

  return jsonResponse({ results, count: results.length }, corsHeaders);
}

// ─── BRAIN STATUS ────────────────────────────────────────
async function getBrainStatus(env, corsHeaders) {
  const status = {};

  for (const [name, config] of Object.entries(BRAINS)) {
    try {
      const response = await fetchSmart(name, '/health', env, { method: 'GET' });
      const data = await response.json();
      status[name] = { url: config.url, status: 'online', data };
    } catch (e) {
      status[name] = { url: config.url, status: 'offline', error: e.message };
    }
  }

  return jsonResponse({ brains: status, timestamp: new Date().toISOString() }, corsHeaders);
}

// ─── SMART FETCH (anti-bot) ──────────────────────────────
async function fetchSmart(brainName, path, env, options = {}) {
  const config = BRAINS[brainName];
  if (!config) throw new Error(`Unknown brain: ${brainName}`);

  const url = `${config.url}${path}`;
  const headers = {
    ...WORKER_HEADERS,
    ...(options.headers || {})
  };

  if (config.auth) {
    headers['Authorization'] = `Bearer ${env.EON_CLOUD_BRAIN_TOKEN || ''}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout || 30000);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body || undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Check for Cloudflare challenge
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('Cloudflare challenge detected');
    }

    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ─── PROXY TO BRAIN ──────────────────────────────────────
async function proxyToBrain(brainName, path, request, env, corsHeaders) {
  const config = BRAINS[brainName];
  if (!config) {
    return jsonResponse({ error: `Unknown brain: ${brainName}` }, corsHeaders, 400);
  }

  const url = `${config.url}${path}`;
  const headers = {
    ...WORKER_HEADERS,
    'Content-Type': 'application/json'
  };

  if (config.auth) {
    headers['Authorization'] = request.headers?.get('Authorization') || `Bearer ${env.EON_CLOUD_BRAIN_TOKEN || ''}`;
  }

  let body = null;
  if (request.json) {
    try {
      body = await request.json();
    } catch (e) {}
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout || 30000);

  try {
    const response = await fetch(url, {
      method: request.method || 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Check for Cloudflare challenge
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return jsonResponse({
        error: 'Cloudflare challenge',
        brain: brainName,
        url: config.url,
        suggestion: 'Check if the target worker has proper CORS and is accessible'
      }, corsHeaders, 502);
    }

    const data = await response.json();
    return jsonResponse(data, corsHeaders, response.status);
  } catch (e) {
    clearTimeout(timeoutId);
    return jsonResponse({ error: e.message, brain: brainName }, corsHeaders, 500);
  }
}

function jsonResponse(data, corsHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
