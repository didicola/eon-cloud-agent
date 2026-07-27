// ═══════════════════════════════════════════════════════════
// EON BRAIN CHAIN v3.0 — The Infinite Intelligence Network
// ═══════════════════════════════════════════════════════════
// Connects: Cloud Brain → ai-cloud-space → eon-p2p-cloud
// Features:
//   - Chain of Brains: routes to best brain for each task
//   - Dream Engine: autonomous thinking and memory synthesis
//   - P2P Delegation: dispatch tasks to local machines
//   - Sync Matrix: bidirectional memory/config/model sync
//   - Provider Registry: dynamic model routing
//   - Self-Upgrade: proposes and applies improvements
//   - Account Management: multi-provider key rotation
//   - Region Metrics: performance tracking
// ═══════════════════════════════════════════════════════════

const BRAINS = {
  'cloud-brain': 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
  'ai-cloud-space': 'https://ai-cloud-space.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
  'eon-p2p': 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Brain-Chain',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ─── BRAIN CHAIN ROUTES ─────────────────────────────
      if (path === '/v1/models' && method === 'GET') {
        return jsonResponse(getModels(), corsHeaders);
      }

      if (path === '/v1/chat/completions' && method === 'POST') {
        return await handleChat(await request.json(), env, corsHeaders);
      }

      // ─── DREAM ENGINE ──────────────────────────────────
      if (path === '/dream/store' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/dream/store', request, env, corsHeaders);
      }

      if (path === '/dream/list' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/dream/list', request, env, corsHeaders);
      }

      if (path === '/dream/cycle' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/dream/cycle', request, env, corsHeaders);
      }

      if (path === '/dream/insights' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/dream/insights', request, env, corsHeaders);
      }

      // ─── SYNC MATRIX ──────────────────────────────────
      if (path === '/sync/config' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/sync/config' + url.search, request, env, corsHeaders);
      }

      if (path === '/sync/config' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/sync/config', request, env, corsHeaders);
      }

      if (path === '/sync/models' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/sync/models', request, env, corsHeaders);
      }

      if (path === '/sync/models' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/sync/models', request, env, corsHeaders);
      }

      if (path === '/sync/memory' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/sync/memory' + url.search, request, env, corsHeaders);
      }

      if (path === '/sync/memory' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/sync/memory', request, env, corsHeaders);
      }

      if (path === '/sync/health' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/sync/health', request, env, corsHeaders);
      }

      // ─── P2P DELEGATION ───────────────────────────────
      if (path === '/delegate/to-cloud' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/delegate/to-cloud', request, env, corsHeaders);
      }

      if (path === '/delegate/to-local' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/delegate/to-local', request, env, corsHeaders);
      }

      if (path === '/delegate/pending' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/delegate/pending', request, env, corsHeaders);
      }

      if (path === '/delegate/result' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/delegate/result', request, env, corsHeaders);
      }

      // ─── OPENCODE DISPATCH ────────────────────────────
      if (path === '/opencode/dispatch' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/opencode/dispatch', request, env, corsHeaders);
      }

      if (path === '/opencode/agents' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/opencode/agents', request, env, corsHeaders);
      }

      if (path === '/opencode/chain' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/opencode/chain', request, env, corsHeaders);
      }

      // ─── SELF UPGRADE ─────────────────────────────────
      if (path === '/upgrade/propose' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/upgrade/propose', request, env, corsHeaders);
      }

      if (path === '/upgrade/pending' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/upgrade/pending', request, env, corsHeaders);
      }

      if (path === '/upgrade/result' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/upgrade/result', request, env, corsHeaders);
      }

      // ─── PROVIDERS ────────────────────────────────────
      if (path === '/providers/register' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/providers/register', request, env, corsHeaders);
      }

      if (path === '/providers/models' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/providers/models', request, env, corsHeaders);
      }

      // ─── ACCOUNTS ─────────────────────────────────────
      if (path === '/accounts/register' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/accounts/register', request, env, corsHeaders);
      }

      if (path === '/accounts/list' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/accounts/list' + url.search, request, env, corsHeaders);
      }

      if (path === '/accounts/rotate' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/accounts/rotate' + url.search, request, env, corsHeaders);
      }

      if (path === '/accounts/remove' && method === 'DELETE') {
        return await proxyToBrain('eon-p2p', '/accounts/remove' + url.search, request, env, corsHeaders);
      }

      // ─── INCENTIVES ───────────────────────────────────
      if (path === '/incentives/balance' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/incentives/balance', request, env, corsHeaders);
      }

      if (path === '/incentives/redeem' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/incentives/redeem', request, env, corsHeaders);
      }

      // ─── P2P PEERS ────────────────────────────────────
      if (path === '/p2p/announce' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/p2p/announce', request, env, corsHeaders);
      }

      if (path === '/p2p/peers' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/p2p/peers', request, env, corsHeaders);
      }

      if (path === '/p2p/tasks' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/p2p/tasks', request, env, corsHeaders);
      }

      if (path === '/p2p/task' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/p2p/task/' + url.searchParams.get('id'), request, env, corsHeaders);
      }

      if (path === '/p2p/connect' && method === 'GET') {
        return await proxyToBrain('eon-p2p', '/p2p/connect', request, env, corsHeaders);
      }

      // ─── ADMIN ────────────────────────────────────────
      if (path === '/admin/verify' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/admin/verify', request, env, corsHeaders);
      }

      if (path === '/admin/migrate' && method === 'POST') {
        return await proxyToBrain('eon-p2p', '/admin/migrate', request, env, corsHeaders);
      }

      if (path.startsWith('/region/') && method === 'GET') {
        return await proxyToBrain('eon-p2p', path, request, env, corsHeaders);
      }

      // ─── KV STORAGE ───────────────────────────────────
      if (path.startsWith('/kv/') && method === 'GET') {
        return await proxyToBrain('ai-cloud-space', path, request, env, corsHeaders);
      }

      if (path.startsWith('/kv/') && method === 'PUT') {
        return await proxyToBrain('ai-cloud-space', path, request, env, corsHeaders);
      }

      if (path.startsWith('/kv/') && method === 'DELETE') {
        return await proxyToBrain('ai-cloud-space', path, request, env, corsHeaders);
      }

      if (path === '/kv' && method === 'GET') {
        return await proxyToBrain('ai-cloud-space', '/kv' + url.search, request, env, corsHeaders);
      }

      // ─── D1 DATABASE ──────────────────────────────────
      if (path.startsWith('/d1/') && method === 'GET') {
        return await proxyToBrain('ai-cloud-space', path, request, env, corsHeaders);
      }

      if (path.startsWith('/d1/') && method === 'PUT') {
        return await proxyToBrain('ai-cloud-space', path, request, env, corsHeaders);
      }

      if (path === '/d1/query' && method === 'POST') {
        return await proxyToBrain('ai-cloud-space', '/d1/query', request, env, corsHeaders);
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
          version: '3.0.0',
          brains: Object.keys(BRAINS),
          features: ['dream-engine', 'sync-matrix', 'p2p-delegation', 'self-upgrade', 'provider-registry', 'account-management', 'kv-storage', 'd1-database']
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
      // Core models
      { id: 'auto', owned_by: 'brain-chain', description: 'Auto-route to best brain' },
      { id: 'code', owned_by: 'brain-chain', description: 'Code generation' },
      { id: 'analysis', owned_by: 'brain-chain', description: 'Deep analysis' },
      { id: 'chat', owned_by: 'brain-chain', description: 'General chat' },
      { id: 'creative', owned_by: 'brain-chain', description: 'Creative writing' },

      // Brain-specific models
      { id: 'dream', owned_by: 'eon-p2p', description: 'Autonomous reflection' },
      { id: 'dream-memory', owned_by: 'eon-p2p', description: 'Dreams based on memories' },
      { id: 'memory', owned_by: 'ai-cloud-space', description: 'Memory-aware responses' },
      { id: 'matrix', owned_by: 'brain-chain', description: 'Matrix routing' },

      // Delegation models
      { id: 'delegate-cloud', owned_by: 'eon-p2p', description: 'Delegate to cloud' },
      { id: 'delegate-local', owned_by: 'eon-p2p', description: 'Delegate to local machine' },

      // Chain models
      { id: 'chain-think', owned_by: 'brain-chain', description: 'Multi-step reasoning' },
      { id: 'chain-act', owned_by: 'brain-chain', description: 'Action planning' },
      { id: 'chain-create', owned_by: 'brain-chain', description: 'Creative generation' },
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
    { role: 'system', content: 'You are EON Brain Chain v3.0, the infinite intelligence network. You coordinate between Cloud Brain, ai-cloud-space, and eon-p2p-cloud. Be concise, technical, and actionable. You have access to dream engine, sync matrix, P2P delegation, and self-upgrade systems.' }
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

  if (lower.includes('upgrade') || lower.includes('improve') || lower.includes('optimize')) {
    return 'chain-think';
  }

  return 'auto';
}

// ─── MEMORY SYSTEM ───────────────────────────────────────
async function getMemoryContext(query, env) {
  try {
    const response = await fetch(`${BRAINS['ai-cloud-space']}/kv?prefix=mem:`, {
      headers: { 'Authorization': `Bearer ${env.EON_CLOUD_BRAIN_TOKEN || ''}` }
    });
    const data = await response.json();
    if (!data.keys?.length) return null;

    const memories = [];
    for (const key of data.keys.slice(0, 10)) {
      const val = await fetch(`${BRAINS['ai-cloud-space']}/kv/${key}`, {
        headers: { 'Authorization': `Bearer ${env.EON_CLOUD_BRAIN_TOKEN || ''}` }
      });
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
    await fetch(`${BRAINS['ai-cloud-space']}/kv/${key}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.EON_CLOUD_BRAIN_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
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

  for (const [name, url] of Object.entries(BRAINS)) {
    try {
      const response = await fetch(`${url}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      status[name] = { url, status: 'online', data };
    } catch (e) {
      status[name] = { url, status: 'offline', error: e.message };
    }
  }

  return jsonResponse({ brains: status, timestamp: new Date().toISOString() }, corsHeaders);
}

// ─── PROXY TO BRAIN ──────────────────────────────────────
async function proxyToBrain(brainName, path, request, env, corsHeaders) {
  const brainUrl = BRAINS[brainName];
  if (!brainUrl) {
    return jsonResponse({ error: `Unknown brain: ${brainName}` }, corsHeaders, 400);
  }

  const url = `${brainUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': request.headers?.get('Authorization') || `Bearer ${env.EON_CLOUD_BRAIN_TOKEN || ''}`
  };

  let body = null;
  if (request.json) {
    try {
      body = await request.json();
    } catch (e) {}
  }

  const response = await fetch(url, {
    method: request.method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();
  return jsonResponse(data, corsHeaders, response.status);
}

function jsonResponse(data, corsHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
