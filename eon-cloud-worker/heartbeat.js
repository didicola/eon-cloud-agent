// ═══════════════════════════════════════════════════════════════════════
// EON SOVEREIGN HEARTBEAT — Auto-Genesis & Fluid Immune System
// The Cloudflare Worker (the Brain) is the PERMANENT master. It monitors
// the local mesh bridge over the .eon tunnel. When the local bridge dies,
// the Worker commands EON-Wrangler (GitHub Actions / Koyeb) to spawn an
// ephemeral genesis VM that takes over compute until local reconnects.
// Zero local daemons. The Cloud monitors itself.
//
// Routing / mesh identity is FLUID: the Cloud covers missing layers with
// Cloudflare WARP + the Chameleon Engine, so Tor failure never kills it.
//
// Pure, env-injected, testable module (no Worker globals assumed beyond
// fetch, which Node 22 also exposes).
// ═══════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  // .eon tunnel / local mesh bridge URL(s). Any HTTP response = local alive.
  meshUrl: 'https://839301ae2a61a843f7bfb701f677195e.x.uplink.spot/',
  meshUrl2: '',
  // Consecutive misses before the Brain triggers Auto-Genesis.
  missesThreshold: 2,
  // Minutes between genesis spawns (anti-storm).
  cooldownMin: 15,
  // Genesis orchestrator targets (GitHub Actions primary, Koyeb optional).
  genesisRepo: 'didicola/eon-cloud-agent',
  genesisWorkflow: 'eon-genesis.yml',
  genesisRef: 'main',
  githubToken: '',
  koyebToken: '',
  koyebAppId: '',
  // Public URL of this worker, passed to the ephemeral VM as the mesh URL.
  selfUrl: '',
  // Gate for mesh endpoints. Empty = open (development), set = required.
  meshToken: '',
  dryRun: false,
};

const MS_MIN = 60000;
const PROBE_TIMEOUT_MS = 4000;
const KV_KEY = 'hb:state';

export function nowMs() {
  return Date.now();
}

export async function probe(url, timeoutMs = PROBE_TIMEOUT_MS) {
  if (!url) return true;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: ctl.signal,
      headers: { 'User-Agent': 'EON-Sovereign-Heartbeat/10.0', 'Accept': '*/*' },
    });
    // Any HTTP status proves the local network/bridge is reachable.
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// ── KV helpers (works with real KVNamespace + a Map-based mock) ──
export async function kvGet(kv, key, fallback = null) {
  if (!kv) return fallback;
  try {
    const v = await kv.get(key, 'json');
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export async function kvPut(kv, key, val) {
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(val));
  } catch {
    /* KV write failure is non-fatal for the heartbeat */
  }
}

function mergeCfg(env) {
  const c = Object.assign({}, DEFAULTS);
  if (!env) return c;
  if (env.EON_MESH_URL) c.meshUrl = env.EON_MESH_URL;
  if (env.EON_MESH_URL2) c.meshUrl2 = env.EON_MESH_URL2;
  if (env.GENESIS_MISSES) c.missesThreshold = parseInt(env.GENESIS_MISSES, 10) || DEFAULTS.missesThreshold;
  if (env.GENESIS_COOLDOWN_MIN) c.cooldownMin = parseInt(env.GENESIS_COOLDOWN_MIN, 10) || DEFAULTS.cooldownMin;
  if (env.GENESIS_REPO) c.genesisRepo = env.GENESIS_REPO;
  if (env.GENESIS_WORKFLOW) c.genesisWorkflow = env.GENESIS_WORKFLOW;
  if (env.GENESIS_REF) c.genesisRef = env.GENESIS_REF;
  if (env.GITHUB_TOKEN) c.githubToken = env.GITHUB_TOKEN;
  if (env.KOYEB_TOKEN) c.koyebToken = env.KOYEB_TOKEN;
  if (env.KOYEB_APP_ID) c.koyebAppId = env.KOYEB_APP_ID;
  if (env.EON_SELF_URL) c.selfUrl = env.EON_SELF_URL;
  if (env.EON_MESH_TOKEN) c.meshToken = env.EON_MESH_TOKEN;
  if (env.GENESIS_DRYRUN === '1' || env.GENESIS_DRYRUN === 'true') c.dryRun = true;
  return c;
}

export function initialState() {
  return {
    lastLocal: 0,
    misses: 0,
    genesisActive: false,
    lastGenesisAt: 0,
    lastProbe: 0,
    localAlive: false,
    genesisEpoch: 0,
    lastDispatch: 0,
  };
}

// ── GitHub Actions dispatch (EON-Wrangler auto-genesis command) ──
export async function dispatchGenesis(cfg, action) {
  const inputs = { event: action, mesh: cfg.selfUrl, epoch: String(Date.now()) };
  if (cfg.dryRun) {
    console.log(`[heartbeat] DRYRUN dispatch event=${action} repo=${cfg.genesisRepo} wf=${cfg.genesisWorkflow} inputs=${JSON.stringify(inputs)}`);
    return { ok: true, dryRun: true };
  }
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'EON-Sovereign-Heartbeat/10.0',
  };
  if (cfg.githubToken) headers.Authorization = `Bearer ${cfg.githubToken}`;

  // Primary: workflow_dispatch
  try {
    const r = await fetch(`https://api.github.com/repos/${cfg.genesisRepo}/actions/workflows/${cfg.genesisWorkflow}/dispatches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: cfg.genesisRef, inputs }),
    });
    if (r.status === 204 || r.status === 201) return { ok: true, via: 'workflow_dispatch', action };
  } catch (e) {
    console.log(`[heartbeat] workflow_dispatch failed: ${e.message}`);
  }

  // Fallback: repository_dispatch (works with default token scope)
  try {
    const r = await fetch(`https://api.github.com/repos/${cfg.genesisRepo}/dispatches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event_type: 'eon-genesis', client_payload: inputs }),
    });
    if (r.status === 204 || r.status === 201) return { ok: true, via: 'repository_dispatch', action };
    return { ok: false, via: 'repository_dispatch', status: r.status };
  } catch (e) {
    return { ok: false, via: 'repository_dispatch', error: e.message };
  }
}

// ── Koyeb fallback spawn (optional; requires KOYEB_TOKEN) ──
export async function dispatchKoyeb(cfg, action) {
  if (cfg.dryRun) return { ok: true, dryRun: true };
  if (!cfg.koyebToken || !cfg.koyebAppId) return { ok: false, via: 'koyeb', skipped: true };
  try {
    const r = await fetch(`https://app.koyeb.com/v1/apps/${cfg.koyebAppId}/pause`, {
      method: action === 'stop' ? 'POST' : 'DELETE',
      headers: { Authorization: `Bearer ${cfg.koyebToken}` },
    });
    return { ok: r.status < 300, via: 'koyeb', status: r.status };
  } catch (e) {
    return { ok: false, via: 'koyeb', error: e.message };
  }
}

// ── THE SOVEREIGN HEARTBEAT TICK ──
// Returns the new state + any actions for the caller to perform.
export async function heartbeatTick(kv, env = {}) {
  const cfg = mergeCfg(env);
  const state = Object.assign(initialState(), await kvGet(kv, KV_KEY, null));

  const localAlive = await probe(cfg.meshUrl)
    || (cfg.meshUrl2 ? await probe(cfg.meshUrl2) : false);

  const now = nowMs();
  state.lastProbe = now;
  state.localAlive = localAlive;

  let action = 'none';

  if (localAlive) {
    state.lastLocal = now;
    state.misses = 0;
    if (state.genesisActive) {
      // Local mesh is back — command the ephemeral VM to cede control.
      state.genesisActive = false;
      state.genesisEpoch += 1;
      const r = await dispatchGenesis(cfg, 'stop');
      state.lastDispatch = now;
      action = 'stop';
      if (cfg.dryRun) action = 'stop(dryrun)';
    }
  } else {
    state.misses += 1;
    const cooldownOk = now - (state.lastGenesisAt || 0) >= cfg.cooldownMin * MS_MIN;
    if (!state.genesisActive && state.misses >= cfg.missesThreshold && cooldownOk) {
      // Local bridge is dead — SPAWN the ephemeral cloud VM instantly.
      state.genesisActive = true;
      state.lastGenesisAt = now;
      const r = await dispatchGenesis(cfg, 'genesis');
      state.lastDispatch = now;
      action = 'trigger';
      if (cfg.dryRun) action = 'trigger(dryrun)';
    }
  }

  await kvPut(kv, KV_KEY, state);
  return { state, action, cfg };
}

// ── API helpers ──
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export function authorized(request, cfg) {
  if (!cfg.meshToken) return true;
  return (request.headers.get('x-eon-token') || '') === cfg.meshToken;
}

export async function handleApi(request, url, kv, env = {}) {
  const cfg = mergeCfg(env);
  const p = url.pathname;

  if (p === '/api/health') {
    const state = Object.assign(initialState(), await kvGet(kv, KV_KEY, null));
    const nodes = await kvGet(kv, 'mesh:nodes', []);
    return json({
      status: 'ok',
      version: env.EON_VERSION || '10.0-sovereign-autogenesis',
      platform: '100% cloud (Cloudflare edge)',
      localAlive: state.localAlive,
      misses: state.misses,
      genesisActive: state.genesisActive,
      genesisEpoch: state.genesisEpoch,
      meshNodes: (nodes || []).length,
      lastProbe: state.lastProbe,
      timestamp: nowMs(),
    });
  }

  if (p === '/api/genesis') {
    if (!authorized(request, cfg)) return json({ ok: false, error: 'unauthorized' }, 403);
    if (request.method === 'GET') {
      const state = await kvGet(kv, KV_KEY, null);
      return json({ ok: true, state });
    }
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const action = body.action === 'stop' ? 'stop' : 'genesis';
      const state = Object.assign(initialState(), await kvGet(kv, KV_KEY, null));
      const r = await dispatchGenesis(cfg, action);
      if (action === 'genesis') { state.genesisActive = true; state.lastGenesisAt = nowMs(); }
      else { state.genesisActive = false; state.genesisEpoch += 1; }
      state.lastDispatch = nowMs();
      await kvPut(kv, KV_KEY, state);
      return json({ ok: r.ok, action, via: r.via, state });
    }
  }

  // Ephemeral genesis VM registers as a mesh compute node (outbound-only).
  if (p === '/api/mesh/register' && request.method === 'POST') {
    if (!authorized(request, cfg)) return json({ ok: false, error: 'unauthorized' }, 403);
    const body = await request.json().catch(() => ({}));
    const nodes = await kvGet(kv, 'mesh:nodes', []);
    const node = {
      id: body.node || 'ghgen-' + String(nowMs()).slice(-8),
      type: body.type || 'ephemeral',
      epoch: body.epoch || '',
      registeredAt: nowMs(),
    };
    nodes.push(node);
    await kvPut(kv, 'mesh:nodes', nodes.slice(-20));
    return json({ ok: true, node });
  }

  // Ephemeral polls for stop / heartbeat commands.
  if (p === '/api/mesh/pulse' && request.method === 'GET') {
    const state = Object.assign(initialState(), await kvGet(kv, KV_KEY, null));
    const stop = !state.genesisActive;
    const localAlive = state.localAlive || false;
    const work = await kvGet(kv, 'mesh:queue', []);
    return json({ ok: true, stop, localAlive, epoch: state.genesisEpoch, pendingWork: (work || []).length });
  }

  // Enqueue compute work for genesis VMs (e.g. dream cycles).
  if (p === '/api/mesh/enqueue' && request.method === 'POST') {
    if (!authorized(request, cfg)) return json({ ok: false, error: 'unauthorized' }, 403);
    const body = await request.json().catch(() => ({}));
    const work = await kvGet(kv, 'mesh:queue', []);
    work.push({ id: 'w' + String(nowMs()).slice(-8), type: body.type || 'dream', payload: body.payload || {}, createdAt: nowMs() });
    await kvPut(kv, 'mesh:queue', work.slice(-50));
    return json({ ok: true, queued: work.length });
  }

  if (p === '/api/mesh/work' && request.method === 'GET') {
    const work = await kvGet(kv, 'mesh:queue', []);
    const batch = (work || []).slice(0, 3);
    const remaining = (work || []).slice(batch.length);
    await kvPut(kv, 'mesh:queue', remaining);
    return json({ ok: true, tasks: batch });
  }

  if (p === '/api/mesh/result' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const results = await kvGet(kv, 'mesh:results', []);
    results.push({ ...body, at: nowMs() });
    await kvPut(kv, 'mesh:results', results.slice(-100));
    return json({ ok: true });
  }

  // Infinite Memory State Sync — snapshot / restore of the entity's state.
  if (p === '/api/state/snapshot' && request.method === 'GET') {
    const experiences = await kvGet(kv, 'experiences', []);
    const offset = await kvGet(kv, 'offset', '0');
    const nodes = await kvGet(kv, 'mesh:nodes', []);
    const hb = await kvGet(kv, KV_KEY, null);
    const payload = { experiences, offset, nodes, hb, version: env.EON_VERSION || '10.0', at: nowMs() };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    return json({ ok: true, state: b64, at: payload.at, experienceCount: (experiences || []).length });
  }

  if (p === '/api/state/restore' && request.method === 'POST') {
    if (!authorized(request, cfg)) return json({ ok: false, error: 'unauthorized' }, 403);
    const body = await request.json().catch(() => ({}));
    try {
      const payload = JSON.parse(Buffer.from(body.state || '', 'base64').toString('utf-8'));
      if (payload.experiences) await kvPut(kv, 'experiences', payload.experiences);
      if (payload.offset) await kvPut(kv, 'offset', String(payload.offset));
      if (payload.nodes) await kvPut(kv, 'mesh:nodes', payload.nodes);
      return json({ ok: true, restored: true });
    } catch (e) {
      return json({ ok: false, error: 'bad state payload: ' + e.message }, 400);
    }
  }

  return json({ ok: false, error: 'unknown api route: ' + p }, 404);
}
