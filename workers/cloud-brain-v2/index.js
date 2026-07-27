// ═══════════════════════════════════════════════════════════
// EON CLOUD BRAIN v2.0 — The Central Intelligence
// ═══════════════════════════════════════════════════════════
// Features:
//   - Multi-model routing (auto, code, analysis, chat)
//   - KV-backed memory (short-term + long-term)
//   - D1 database for persistent state
//   - Machine health tracking
//   - Intelligent request routing
//   - Context-aware responses
//   - GitHub API integration for cross-machine commands
// ═══════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ─── ROUTES ───────────────────────────────────────────
    try {
      // Models list
      if (path === '/v1/models' && method === 'GET') {
        return jsonResponse({
          object: 'list',
          data: [
            { id: 'auto', object: 'model', owned_by: 'eon-brain', description: 'Auto-route to best model' },
            { id: 'code', object: 'model', owned_by: 'eon-brain', description: 'Code generation' },
            { id: 'analysis', object: 'model', owned_by: 'eon-brain', description: 'Deep analysis' },
            { id: 'chat', object: 'model', owned_by: 'eon-brain', description: 'General chat' },
            { id: 'memory', object: 'model', owned_by: 'eon-brain', description: 'Memory-aware responses' },
            { id: 'dream', object: 'model', owned_by: 'eon-brain', description: 'Autonomous thinking' },
            { id: 'matrix', object: 'model', owned_by: 'eon-brain', description: 'Matrix routing' },
            { id: 'dream-memory', object: 'model', owned_by: 'eon-brain', description: 'Dreams based on memories' },
            { id: 'analyze-memory', object: 'model', owned_by: 'eon-brain', description: 'Analyze stored memories' },
            { id: 'creative', object: 'model', owned_by: 'eon-brain', description: 'Creative writing' },
          ]
        }, corsHeaders);
      }

      // Chat completions (OpenAI compatible)
      if (path === '/v1/chat/completions' && method === 'POST') {
        const body = await request.json();
        return await handleChat(body, env, corsHeaders);
      }

      // Memory endpoints
      if (path === '/memory/store' && method === 'POST') {
        return await handleMemoryStore(request, env, corsHeaders);
      }

      if (path === '/memory/query' && method === 'POST') {
        return await handleMemoryQuery(request, env, corsHeaders);
      }

      if (path === '/memory/list' && method === 'GET') {
        return await handleMemoryList(env, corsHeaders);
      }

      // Machine status
      if (path === '/machine/status' && method === 'GET') {
        return await handleMachineStatus(env, corsHeaders);
      }

      if (path === '/machine/heartbeat' && method === 'POST') {
        return await handleHeartbeat(request, env, corsHeaders);
      }

      // GitHub relay
      if (path === '/relay/send' && method === 'POST') {
        return await handleRelaySend(request, env, corsHeaders);
      }

      if (path === '/relay/poll' && method === 'GET') {
        return await handleRelayPoll(request, env, corsHeaders);
      }

      // Health check
      if (path === '/health') {
        return jsonResponse({
          status: 'ok',
          version: '2.0.0',
          uptime: Date.now(),
          features: ['multi-model', 'memory', 'relay', 'machine-tracking']
        }, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, corsHeaders, 500);
    }
  }
};

// ─── CHAT COMPLETIONS HANDLER ─────────────────────────────
async function handleChat(body, env, corsHeaders) {
  const messages = body.messages || [];
  const model = body.model || 'auto';
  const maxTokens = body.max_tokens || 1500;

  // Get context from memory
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const context = lastUserMsg ? lastUserMsg.content : '';

  // Route to best model based on content
  const routedModel = routeModel(model, context, messages);

  // Get memory context
  const memoryContext = await getMemoryContext(context, env);

  // Build enhanced prompt
  const enhancedMessages = [
    ...messages,
    ...(memoryContext ? [{ role: 'system', content: `Memory context: ${memoryContext}` }] : []),
    { role: 'system', content: 'You are EON Cloud Brain, the central intelligence of the Parallel World system. You coordinate between Termux phone and Ubuntu laptop. Be concise, technical, and actionable.' }
  ];

  // Get response from upstream model
  const response = await fetchUpstream(routedModel, enhancedMessages, maxTokens, env);

  // Store in memory
  if (lastUserMsg) {
    await storeMemory(lastUserMsg.content, response, env);
  }

  // Update machine status
  if (context.includes('heartbeat') || context.includes('status')) {
    await updateMachineStatus(context, env);
  }

  return jsonResponse(response, corsHeaders);
}

// ─── MODEL ROUTING ────────────────────────────────────────
function routeModel(requestedModel, context, messages) {
  if (requestedModel !== 'auto') return requestedModel;

  const lower = context.toLowerCase();

  // Code detection
  if (lower.includes('def ') || lower.includes('function') || lower.includes('class ') ||
      lower.includes('import ') || lower.includes('async ') || lower.includes('await ') ||
      lower.includes('```') || lower.includes('code') || lower.includes('implement')) {
    return 'code';
  }

  // Analysis detection
  if (lower.includes('analyze') || lower.includes('compare') || lower.includes('evaluate') ||
      lower.includes('explain') || lower.includes('why') || lower.includes('how does') ||
      lower.includes('architecture') || lower.includes('design')) {
    return 'analysis';
  }

  // Dream detection
  if (lower.includes('dream') || lower.includes('imagine') || lower.includes('what if') ||
      lower.includes('envision') || lower.includes('future')) {
    return 'dream';
  }

  // Memory detection
  if (lower.includes('remember') || lower.includes('memory') || lower.includes('recall') ||
      lower.includes('what did') || lower.includes('last time') || lower.includes('history')) {
    return 'memory';
  }

  // Matrix detection
  if (lower.includes('matrix') || lower.includes('route') || lower.includes('relay') ||
      lower.includes('dispatch') || lower.includes('coordinate')) {
    return 'matrix';
  }

  // Default
  return 'chat';
}

// ─── MEMORY SYSTEM ────────────────────────────────────────
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
    await env.EON_KV?.put(key, JSON.stringify(entry), { expirationTtl: 86400 * 7 });
  } catch (e) { /* KV might not be configured */ }
}

async function getMemoryContext(query, env) {
  try {
    const list = await env.EON_KV?.list({ prefix: 'mem:', limit: 10 });
    if (!list?.keys?.length) return null;

    const memories = [];
    for (const key of list.keys) {
      const val = await env.EON_KV?.get(key.name);
      if (val) memories.push(JSON.parse(val));
    }

    // Simple relevance scoring
    const scored = memories
      .map(m => ({
        ...m,
        score: (m.input + m.response).toLowerCase().split(' ')
          .filter(w => query.toLowerCase().includes(w)).length
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return scored.map(m => `[${m.timestamp}] ${m.input}: ${m.response?.substring(0, 100)}`).join('\n');
  } catch (e) {
    return null;
  }
}

async function handleMemoryStore(request, env, corsHeaders) {
  const body = await request.json();
  const key = `mem:${body.key || Date.now()}`;
  const entry = {
    content: body.content,
    type: body.type || 'manual',
    timestamp: new Date().toISOString(),
    tags: body.tags || []
  };
  await env.EON_KV?.put(key, JSON.stringify(entry), { expirationTtl: body.ttl || 86400 * 30 });
  return jsonResponse({ stored: key }, corsHeaders);
}

async function handleMemoryQuery(request, env, corsHeaders) {
  const body = await request.json();
  const query = body.query || '';
  const limit = body.limit || 10;

  const list = await env.EON_KV?.list({ prefix: 'mem:', limit: 50 });
  if (!list?.keys?.length) {
    return jsonResponse({ results: [], count: 0 }, corsHeaders);
  }

  const results = [];
  for (const key of list.keys) {
    const val = await env.EON_KV?.get(key.name);
    if (val) {
      const entry = JSON.parse(val);
      const score = (entry.content || entry.input || '').toLowerCase()
        .split(' ').filter(w => query.toLowerCase().includes(w)).length;
      if (score > 0 || !query) {
        results.push({ ...entry, score, key: key.name });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return jsonResponse({ results: results.slice(0, limit), count: results.length }, corsHeaders);
}

async function handleMemoryList(env, corsHeaders) {
  const list = await env.EON_KV?.list({ prefix: 'mem:', limit: 100 });
  const memories = [];
  if (list?.keys) {
    for (const key of list.keys) {
      const val = await env.EON_KV?.get(key.name);
      if (val) memories.push({ key: key.name, ...JSON.parse(val) });
    }
  }
  return jsonResponse({ memories, count: memories.length }, corsHeaders);
}

// ─── MACHINE STATUS ───────────────────────────────────────
async function handleMachineStatus(env, corsHeaders) {
  try {
    const status = await env.EON_KV?.get('machine:status');
    return jsonResponse(status ? JSON.parse(status) : { machines: {} }, corsHeaders);
  } catch (e) {
    return jsonResponse({ machines: {}, error: e.message }, corsHeaders);
  }
}

async function handleHeartbeat(request, env, corsHeaders) {
  const body = await request.json();
  const machineId = body.machine || 'unknown';

  const status = {
    machine: machineId,
    ip: body.ip || 'unknown',
    services: body.services || {},
    timestamp: new Date().toISOString(),
    uptime: body.uptime || 0
  };

  // Store latest heartbeat
  await env.EON_KV?.put(`machine:${machineId}`, JSON.stringify(status), { expirationTtl: 300 });

  // Update machine list
  const list = await env.EON_KV?.get('machine:status');
  const machines = list ? JSON.parse(list).machines : {};
  machines[machineId] = status;
  await env.EON_KV?.put('machine:status', JSON.stringify({ machines, lastUpdate: new Date().toISOString() }));

  return jsonResponse({ ok: true, machine: machineId }, corsHeaders);
}

// ─── GITHUB RELAY ─────────────────────────────────────────
async function handleRelaySend(request, env, corsHeaders) {
  const body = await request.json();
  const { target, cmd, from } = body;

  if (!target || !cmd) {
    return jsonResponse({ error: 'target and cmd required' }, corsHeaders, 400);
  }

  const ts = Math.floor(Date.now() / 1000);
  const filename = `matrix/${target}_${from || 'cloud'}_${ts}.cmd`;
  const content = JSON.stringify({ from: from || 'cloud', to: target, cmd, ts, id: Math.random().toString(36).substr(2, 8) });

  // Store in KV
  await env.EON_KV?.put(`relay:${filename}`, content, { expirationTtl: 3600 });

  // Try GitHub API
  try {
    const githubToken = env.EON_GITHUB_TOKEN;
    if (githubToken) {
      const repo = 'didicola/eon-cloud-agent';
      const encoded = btoa(content);
      await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'EonCloudBrain/2.0'
        },
        body: JSON.stringify({
          message: `CMD from ${from || 'cloud'} to ${target}`,
          content: encoded,
          branch: 'main'
        })
      });
    }
  } catch (e) { /* KV fallback */ }

  return jsonResponse({ ok: true, file: filename }, corsHeaders);
}

async function handleRelayPoll(request, env, corsHeaders) {
  const url = new URL(request.url);
  const machine = url.searchParams.get('machine') || 'ubuntu';

  const list = await env.EON_KV?.list({ prefix: `relay:matrix/${machine}_`, limit: 20 });
  const commands = [];

  if (list?.keys) {
    for (const key of list.keys) {
      const val = await env.EON_KV?.get(key.name);
      if (val) {
        const cmd = JSON.parse(val);
        if (cmd.to === machine) {
          commands.push({ file: key.name, ...cmd });
        }
      }
    }
  }

  return jsonResponse({ commands, count: commands.length }, corsHeaders);
}

// ─── UPSTREAM FETCH ───────────────────────────────────────
async function fetchUpstream(model, messages, maxTokens, env) {
  // Map EON models to OpenRouter models
  const modelMap = {
    'code': 'anthropic/claude-sonnet-4',
    'analysis': 'anthropic/claude-sonnet-4',
    'chat': 'anthropic/claude-sonnet-4',
    'memory': 'anthropic/claude-sonnet-4',
    'dream': 'anthropic/claude-sonnet-4',
    'matrix': 'anthropic/claude-sonnet-4',
    'auto': 'anthropic/claude-sonnet-4',
    'creative': 'anthropic/claude-sonnet-4',
    'dream-memory': 'anthropic/claude-sonnet-4',
    'analyze-memory': 'anthropic/claude-sonnet-4',
  };

  const upstreamModel = modelMap[model] || 'anthropic/claude-sonnet-4';
  const apiKey = env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return { choices: [{ message: { content: `[Cloud Brain] No API key configured. Model: ${model}` } }] };
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://eon-cloud-agent.local',
      'X-Title': 'EON Cloud Brain v2'
    },
    body: JSON.stringify({
      model: upstreamModel,
      messages,
      max_tokens: maxTokens,
      temperature: model === 'code' ? 0.2 : model === 'analysis' ? 0.3 : 0.7,
    })
  });

  return await response.json();
}

function jsonResponse(data, corsHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
