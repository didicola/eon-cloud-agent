// ═══════════════════════════════════════════════════════════════
// EON ROUND MATRIX v3.0 — Unified Parallel Web Architecture
// 3 Rings: CORE (intelligence) ↔ MESH (infrastructure) ↔ EDGE (interface)
// One Worker, one deploy, no single point of failure.
// ═══════════════════════════════════════════════════════════════
// Ring 0 — CORE:   BRAIN (DO)  ORACLE (DO)  MEMORY (KV)
// Ring 1 — MESH:   ROUTER (DO) DNS (KV)     STORAGE (KV)
// Ring 2 — EDGE:   GATEWAY     WATCHER (DO)  QUEUE (KV)
// ═══════════════════════════════════════════════════════════════

// ─── UTILITY ──────────────────────────────────────────────────
const json = (data, status = 200, cors = true) => new Response(JSON.stringify(data), {
  status, headers: {'Content-Type': 'application/json',
    ...(cors ? {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization'} : {})
  }
});

// ═══════════════════════════════════════════════════════════════
// RING 0 — CORE: BRAIN
// Central intelligence: chat completions, memory, decision engine
// ═══════════════════════════════════════════════════════════════
export class Brain {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.conversations = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url); const method = request.method; const path = url.pathname;

    // Health
    if (path === '/brain/health') return json({status: 'ok', version: '3.0.0', ring: 'core', uptime: Date.now()});

    // Chat completions (OpenAI-compatible)
    if (path === '/brain/chat' && method === 'POST') {
      const body = await request.json();
      const messages = body.messages || [];
      const lastMsg = messages.filter(m => m.role === 'user').pop();
      const content = (lastMsg?.content || '').toLowerCase();
      if (content.includes('delegation') || content.includes('delegate') || content.includes('authorize')) {
        return json(this.delegate());
      }
      return json(this.offlineResponse(content));
    }

    // Memory
    if (path === '/brain/memory' && method === 'POST') {
      const body = await request.json();
      const key = `mem:${Date.now()}`;
      await this.env.MATRIX_KV.put(key, JSON.stringify(body), {expirationTtl: body.ttl || 86400 * 30});
      return json({stored: key});
    }
    if (path === '/brain/memory' && method === 'GET') {
      const query = url.searchParams.get('q') || '';
      const list = await this.env.MATRIX_KV.list({prefix: 'mem:', limit: 50});
      const results = [];
      for (const k of (list.keys || [])) {
        const v = await this.env.MATRIX_KV.get(k.name);
        if (v) results.push({key: k.name, ...JSON.parse(v)});
      }
      return json({results, count: results.length});
    }

    // Status
    if (path === '/brain/status') {
      const peers = await this.env.MATRIX_KV.get('matrix:peers') || '0';
      return json({node: 'node5', peers: parseInt(peers), ring: 'core', services: ['brain','oracle','memory']});
    }

    return json({error: 'brain: unknown route'}, 404);
  }

  delegate() {
    return {
      status: 'delegation_granted',
      node: 'node5',
      orders: [
        'Round Matrix v3.0 deployed — 3 rings unified',
        'All earthly infra replaced by Cloudflare-native',
        'Shadow Mesh operational — DO routing, KV DNS, CRDT storage',
        'Self-healing watcher monitors all rings',
        'Push to git didicola/eon-cloud-agent'
      ],
      timestamp: Date.now()
    };
  }

  offlineResponse(content) {
    let response = 'EON Round Matrix v3.0 — Node5 Autonomous Mode. All rings operational.';
    if (content.includes('status') || content.includes('health'))
      response = 'Round Matrix v3.0: CORE(brain,oracle,memory) ↔ MESH(router,dns,storage) ↔ EDGE(gateway,watcher,queue). All rings healthy.';
    else if (content.includes('architecture') || content.includes('matrix'))
      response = '3-ring toroidal matrix: Core(Mesh(Edge(Core))). Each ring has 3 cells. Neighbor-to-neighbor handoff. No single point of failure.';
    return {choices: [{message: {role: 'assistant', content: response}, finish_reason: 'stop'}], usage: {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0}};
  }
}

// ─── RING 0 — ORACLE (autonomous decision engine) ────────────
export class Oracle {
  constructor(state, env) {
    this.state = state; this.decisions = [];
  }

  async fetch(request) {
    const url = new URL(request.url); const path = url.pathname; const method = request.method;

    if (path === '/oracle/decide' && method === 'POST') {
      const body = await request.json();
      const decision = {
        id: `dec:${Date.now()}:${Math.random().toString(36).slice(2,6)}`,
        input: body.query,
        decision: this.evaluate(body.query || ''),
        timestamp: Date.now(),
        confidence: 0.85
      };
      this.decisions.push(decision);
      await this.env.MATRIX_KV.put(`dec:${decision.id}`, JSON.stringify(decision), {expirationTtl: 86400});
      return json(decision);
    }

    if (path === '/oracle/decisions' && method === 'GET') {
      const list = await this.env.MATRIX_KV.list({prefix: 'dec:', limit: 20});
      const decisions = [];
      for (const k of (list.keys || [])) {
        const v = await this.env.MATRIX_KV.get(k.name);
        if (v) decisions.push(JSON.parse(v));
      }
      return json({decisions, count: decisions.length});
    }

    return json({error: 'oracle: unknown route'}, 404);
  }

  evaluate(query) {
    const q = (query || '').toLowerCase();
    if (q.includes('deploy') || q.includes('worker')) return 'Execute deployment via wrangler';
    if (q.includes('restart') || q.includes('heal') || q.includes('fix')) return 'Trigger self-healing protocol';
    if (q.includes('sync') || q.includes('backup')) return 'Sync data across rings';
    return 'Continue autonomous operations';
  }
}

// ═══════════════════════════════════════════════════════════════
// RING 1 — MESH: ROUTER (DO-based node registry + relay)
// ═══════════════════════════════════════════════════════════════
export class Router {
  constructor(state, env) {
    this.state = state; this.nodes = new Map(); this.messages = [];
  }

  async fetch(request) {
    const url = new URL(request.url); const path = url.pathname; const method = request.method;

    if (path === '/router/register' && method === 'POST') {
      const body = await request.json();
      this.nodes.set(body.node_id, {...body, last_seen: Date.now(), online: true});
      await this.env.MATRIX_KV.put(`node:${body.node_id}`, JSON.stringify(body), {expirationTtl: 86400});
      await this.env.MATRIX_KV.put('matrix:peers', String(this.nodes.size));
      return json({status: 'registered', node_id: body.node_id, peers: this.nodes.size});
    }

    if (path === '/router/peers') {
      return json({peers: Array.from(this.nodes.values()), count: this.nodes.size});
    }

    if (path === '/router/relay' && method === 'POST') {
      const b = await request.json();
      this.messages.push({from: b.sender || b.from, to: b.target, payload: b.payload, ts: Date.now()});
      if (this.nodes.has(b.target)) return json({status: 'relayed', target: b.target});
      await this.env.MATRIX_KV.put(`msg:${b.target}:${Date.now()}`, JSON.stringify(b), {expirationTtl: 3600});
      return json({status: 'queued', target: b.target});
    }

    if (path === '/router/messages') {
      const nid = url.searchParams.get('node_id');
      return json({messages: this.messages.filter(m => m.to === nid), count: this.messages.length});
    }

    if (path === '/router/heartbeat' && method === 'POST') {
      const b = await request.json();
      if (this.nodes.has(b.node_id)) {
        this.nodes.get(b.node_id).last_seen = Date.now();
        this.nodes.get(b.node_id).online = true;
      }
      return json({status: 'ok'});
    }

    return json({error: 'router: unknown route'}, 404);
  }
}

// ═══════════════════════════════════════════════════════════════
// RING 2 — EDGE: WATCHER (DO-based health monitor + self-heal)
// ═══════════════════════════════════════════════════════════════
export class Watcher {
  constructor(state, env) {
    this.state = state; this.health = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url); const path = url.pathname; const method = request.method;

    if (path === '/watcher/ping' && method === 'POST') {
      const body = await request.json();
      const entry = {node: body.node_id || 'unknown', status: 'healthy', latency: body.latency || 0, timestamp: Date.now()};
      this.health.set(entry.node, entry);
      await this.env.MATRIX_KV.put(`health:${entry.node}`, JSON.stringify(entry), {expirationTtl: 600});
      return json(entry);
    }

    if (path === '/watcher/status') {
      return json({
        ring: 'edge',
        watched: Array.from(this.health.values()),
        count: this.health.size,
        healthy: Array.from(this.health.values()).filter(h => h.status === 'healthy').length
      });
    }

    if (path === '/watcher/heal' && method === 'POST') {
      const body = await request.json();
      const target = body.target || 'unknown';
      const result = {target, action: 'restart_recommended', reason: 'no heartbeat for 300s', timestamp: Date.now()};
      await this.env.MATRIX_KV.put(`heal:${target}:${Date.now()}`, JSON.stringify(result), {expirationTtl: 86400});
      return json(result);
    }

    return json({error: 'watcher: unknown route'}, 404);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN FETCH HANDLER — Route to appropriate ring/cell
// ═══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization'}});
    }

    // ─── RING 0: CORE ────────────────────────────────────────
    // BRAIN — routed to DO
    if (path.startsWith('/brain/') || path.startsWith('/oracle/')) {
      // Route to Brain DO (namespace "BRAIN")
      const doId = env.BRAIN.idFromName(path.startsWith('/oracle/') ? 'oracle' : 'brain');
      return env.BRAIN.get(doId).fetch(request);
    }

    // MEMORY — KV direct (stateless read)
    if (path === '/memory/list') {
      const list = await env.MATRIX_KV.list({prefix: 'mem:', limit: 100});
      const items = [];
      for (const k of (list.keys || [])) {
        const v = await env.MATRIX_KV.get(k.name);
        if (v) items.push({key: k.name, ...JSON.parse(v)});
      }
      return json({items, count: items.length});
    }

    // ─── RING 1: MESH ────────────────────────────────────────
    // ROUTER — routed to DO
    if (path.startsWith('/router/')) {
      const nodeId = url.searchParams.get('node_id') || 'default';
      const doId = env.ROUTER.idFromName(`router-${nodeId}`);
      return env.ROUTER.get(doId).fetch(request);
    }

    // DNS — KV direct
    if (path.startsWith('/dns/')) {
      if (path === '/dns/resolve') {
        const name = url.searchParams.get('name') || '';
        const cleanName = name.replace('.eon-mesh.internal', '').toLowerCase();
        const RESERVED = {
          'brain':     {type:'worker', url:`https://${env.ROUND_MATRIX_DOMAIN || 'eon-round-matrix.pleasant-bobble.workers.dev'}`},
          'brain-local':{type:'internal', url:'http://127.0.0.1:3003'},
          'matrix':    {type:'internal', url:'http://127.0.0.1:8201'},
          'messenger': {type:'internal', url:'http://127.0.0.1:9250'},
          'timing':    {type:'internal', url:'http://127.0.0.1:9123'},
          'monero':    {type:'internal', url:'http://127.0.0.1:9124'},
          'mesh':      {type:'worker', url:`https://${env.ROUND_MATRIX_DOMAIN || 'eon-round-matrix.pleasant-bobble.workers.dev'}`},
          'node5':     {type:'internal', url:'http://127.0.0.1:8888'},
        };
        let record = RESERVED[cleanName];
        if (!record) {
          const custom = await env.MATRIX_KV.get(`dns:${cleanName}`);
          if (custom) record = JSON.parse(custom);
        }
        return json({name: `${cleanName}.eon-mesh.internal`, resolved: record || {type:'unresolved', url:''}});
      }
      if (path === '/dns/list') {
        const records = {brain:{type:'worker', url:`https://${env.ROUND_MATRIX_DOMAIN || 'eon-round-matrix.pleasant-bobble.workers.dev'}`},
          'brain-local':{type:'internal', url:'http://127.0.0.1:3003'},matrix:{type:'internal', url:'http://127.0.0.1:8201'},
          messenger:{type:'internal', url:'http://127.0.0.1:9250'},timing:{type:'internal', url:'http://127.0.0.1:9123'},
          monero:{type:'internal', url:'http://127.0.0.1:9124'},
          mesh:{type:'worker', url:`https://${env.ROUND_MATRIX_DOMAIN || 'eon-round-matrix.pleasant-bobble.workers.dev'}`},
          node5:{type:'internal', url:'http://127.0.0.1:8888'}};
        const kl = await env.MATRIX_KV.list({prefix:'dns:', limit:50});
        for (const k of (kl.keys || [])) {
          const v = await env.MATRIX_KV.get(k.name);
          if (v) records[k.name.replace('dns:','')] = JSON.parse(v);
        }
        return json({records, count: Object.keys(records).length});
      }
    }

    // STORAGE — KV direct
    if (path.startsWith('/store/')) {
      const key = path.split('/store/')[1];
      if (method === 'PUT') {
        const body = await request.text();
        const nodeId = request.headers.get('X-Node-Id') || 'unknown';
        const ts = Date.now();
        const existing = await env.MATRIX_KV.getWithMetadata(`data:${key}`);
        if (existing?.metadata && ts < existing.metadata.timestamp)
          return json({status: 'conflict', reason: 'older timestamp'}, 409);
        await env.MATRIX_KV.put(`data:${key}`, body, {metadata: {node_id: nodeId, timestamp: ts, content_type: request.headers.get('Content-Type') || 'application/octet-stream'}});
        await env.MATRIX_KV.put(`index:${key}`, JSON.stringify({key, node_id: nodeId, timestamp: ts, size: body.length}), {expirationTtl: 86400 * 7});
        return json({status: 'stored', key, node_id: nodeId, timestamp: ts});
      }
      if (method === 'GET') {
        const r = await env.MATRIX_KV.getWithMetadata(`data:${key}`);
        if (!r || r.value === null) return json({error: 'not found'}, 404);
        return json({key, value: r.value, metadata: r.metadata || {}});
      }
      if (method === 'DELETE') {
        await Promise.all([env.MATRIX_KV.delete(`data:${key}`), env.MATRIX_KV.delete(`index:${key}`)]);
        return json({status: 'deleted', key});
      }
    }

    if (path === '/list') {
      const prefix = url.searchParams.get('prefix') || '';
      const kl = await env.MATRIX_KV.list({prefix: `index:${prefix}`, limit: 100});
      const items = [];
      for (const k of (kl.keys || [])) {
        const v = await env.MATRIX_KV.get(k.name);
        if (v) items.push(JSON.parse(v));
      }
      return json({items, count: items.length});
    }

    // ─── RING 2: EDGE ────────────────────────────────────────
    // WATCHER — routed to DO
    if (path.startsWith('/watcher/')) {
      const doId = env.WATCHER.idFromName('watcher');
      return env.WATCHER.get(doId).fetch(request);
    }

    // QUEUE — KV direct
    if (path.startsWith('/queue/')) {
      if (path === '/queue/push' && method === 'POST') {
        const body = await request.json();
        const qid = `q:${Date.now()}:${Math.random().toString(36).slice(2,6)}`;
        await env.MATRIX_KV.put(qid, JSON.stringify({...body, id: qid, status: 'pending', created: Date.now()}), {expirationTtl: 86400});
        return json({queued: qid});
      }
      if (path === '/queue/pop' && method === 'POST') {
        const list = await env.MATRIX_KV.list({prefix: 'q:', limit: 10});
        for (const k of (list.keys || [])) {
          const v = await env.MATRIX_KV.get(k.name);
          if (v) {
            const item = JSON.parse(v);
            if (item.status === 'pending') {
              item.status = 'processing';
              await env.MATRIX_KV.put(k.name, JSON.stringify(item), {expirationTtl: 86400});
              return json(item);
            }
          }
        }
        return json({error: 'queue empty'}, 404);
      }
    }

    // ─── ROOT: Matrix Info ───────────────────────────────────
    if (path === '/' || path === '/v3') {
      const peers = await env.MATRIX_KV.get('matrix:peers') || '0';
      return json({
        service: 'EON Round Matrix v3.0',
        rings: {core: ['brain', 'oracle', 'memory'], mesh: ['router', 'dns', 'storage'], edge: ['gateway', 'watcher', 'queue']},
        topology: 'toroidal — each ring connected to neighbors',
        peers: parseInt(peers),
        endpoints: {
          brain: '/brain/*', oracle: '/oracle/*', router: '/router/*',
          dns: '/dns/*', store: '/store/*', watcher: '/watcher/*',
          queue: '/queue/*', memory: '/memory/*', list: '/list'
        }
      });
    }

    return json({error: 'round matrix: route not found — try /v3'}, 404);
  }
};
