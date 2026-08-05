// EON ROUND MATRIX v3.0 — Pure KV Architecture (no DO)
// 3 Rings: CORE ↔ MESH ↔ EDGE, all stateless via KV
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS
    if (method === 'OPTIONS') {
      return new Response(null, {headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
      }});
    }

    const h = (data, s=200) => new Response(JSON.stringify(data), {status:s, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});

    // ─── ROOT ──────────────────────────────────────────
    if (path === '/' || path === '/v3') {
      const peers = await env.MATRIX_KV.get('matrix:peers') || '0';
      return h({
        service: 'EON Round Matrix v3.0',
        rings: {core:['brain','oracle','memory'], mesh:['router','dns','storage'], edge:['gateway','watcher','queue']},
        topology: 'toroidal — 3 rings, KV-backed',
        peers: parseInt(peers),
        endpoints: {
          brain:'/v1/chat', oracle:'/v1/decide', memory:'/v1/memory',
          router:'/v1/router', dns:'/v1/dns', store:'/v1/store',
          watcher:'/v1/watch', queue:'/v1/queue'
        }
      });
    }

    // ─── RING 0: CORE ──────────────────────────────────
    // BRAIN
    if (path === '/v1/chat' && method === 'POST') {
      const body = await request.json();
      const msgs = body.messages || [];
      const last = msgs.filter(m => m.role === 'user').pop();
      const content = (last?.content || '').toLowerCase();

      let response = 'EON Round Matrix v3.0 — Autonomous.';
      if (content.includes('delegation') || content.includes('delegate'))
        response = 'DELEGATION GRANTED. Round Matrix v3.0 operational. 3 rings: CORE/MESH/EDGE. All KV-backed.';
      else if (content.includes('status') || content.includes('health'))
        response = 'Round Matrix: CORE(brain) ↔ MESH(router/dns/store) ↔ EDGE(watcher/queue). All KV-backed.';

      return h({choices:[{message:{role:'assistant',content:response},finish_reason:'stop'}], usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}});
    }

    // ORACLE
    if (path === '/v1/decide' && method === 'POST') {
      const body = await request.json();
      const q = (body.query || '').toLowerCase();
      let decision = 'continue autonomous ops';
      if (q.includes('deploy') || q.includes('worker')) decision = 'Execute deployment via wrangler';
      if (q.includes('restart') || q.includes('heal')) decision = 'Trigger self-healing';
      if (q.includes('sync') || q.includes('backup')) decision = 'Sync data across rings';
      const dec = {id:`dec:${Date.now()}`, query:body.query, decision, timestamp:Date.now()};
      await env.MATRIX_KV.put(`dec:${dec.id}`, JSON.stringify(dec), {expirationTtl:86400});
      return h(dec);
    }

    // MEMORY
    if (path === '/v1/memory') {
      if (method === 'POST') {
        const body = await request.json();
        const key = `mem:${Date.now()}`;
        await env.MATRIX_KV.put(key, JSON.stringify(body), {expirationTtl:body.ttl||86400*30});
        return h({stored:key});
      }
      if (method === 'GET') {
        const list = await env.MATRIX_KV.list({prefix:'mem:', limit:50});
        const items = [];
        for (const k of (list.keys||[])) {const v=await env.MATRIX_KV.get(k.name); if(v) items.push({key:k.name,...JSON.parse(v)});}
        return h({items, count:items.length});
      }
    }

    // ─── RING 1: MESH ──────────────────────────────────
    // ROUTER
    if (path === '/v1/router/register' && method === 'POST') {
      const body = await request.json();
      await env.MATRIX_KV.put(`node:${body.node_id}`, JSON.stringify({...body,last_seen:Date.now()}), {expirationTtl:86400});
      const count = (await env.MATRIX_KV.list({prefix:'node:'})).keys.length;
      await env.MATRIX_KV.put('matrix:peers', String(count));
      return h({status:'registered', node_id:body.node_id, peers:count});
    }

    if (path === '/v1/router/peers') {
      const list = await env.MATRIX_KV.list({prefix:'node:'});
      const peers = [];
      for (const k of (list.keys||[])) {const v=await env.MATRIX_KV.get(k.name); if(v) peers.push(JSON.parse(v));}
      return h({peers, count:peers.length});
    }

    if (path === '/v1/router/heartbeat' && method === 'POST') {
      const body = await request.json();
      const existing = await env.MATRIX_KV.get(`node:${body.node_id}`);
      if (existing) {
        const node = JSON.parse(existing);
        node.last_seen = Date.now();
        node.online = true;
        await env.MATRIX_KV.put(`node:${body.node_id}`, JSON.stringify(node), {expirationTtl:86400});
      }
      return h({status:'ok'});
    }

    if (path === '/v1/router/relay' && method === 'POST') {
      const b = await request.json();
      const msg = {from:b.sender||b.from, to:b.target, payload:b.payload, ts:Date.now()};
      await env.MATRIX_KV.put(`msg:${b.target}:${Date.now()}`, JSON.stringify(msg), {expirationTtl:3600});
      return h({status:'queued', target:b.target});
    }

    if (path === '/v1/router/messages') {
      const nid = url.searchParams.get('node_id');
      const list = await env.MATRIX_KV.list({prefix:`msg:${nid}:`});
      const msgs = [];
      for (const k of (list.keys||[])) {const v=await env.MATRIX_KV.get(k.name); if(v) msgs.push(JSON.parse(v));}
      return h({messages:msgs, count:msgs.length});
    }

    // DNS
    if (path === '/v1/dns/resolve') {
      const name = (url.searchParams.get('name')||'').replace('.eon-mesh.internal','').toLowerCase();
      const RESERVED = {
        brain:{type:'worker',url:`https://eon-round-matrix.pleasant-bobble.workers.dev`},
        'brain-local':{type:'internal',url:'http://127.0.0.1:3003'},
        matrix:{type:'internal',url:'http://127.0.0.1:8201'},
        messenger:{type:'internal',url:'http://127.0.0.1:9250'},
        timing:{type:'internal',url:'http://127.0.0.1:9123'},
        monero:{type:'internal',url:'http://127.0.0.1:9124'},
        mesh:{type:'worker',url:`https://eon-round-matrix.pleasant-bobble.workers.dev`},
        node5:{type:'internal',url:'http://127.0.0.1:8888'}
      };
      let record = RESERVED[name];
      if (!record) { const custom = await env.MATRIX_KV.get(`dns:${name}`); if(custom) record=JSON.parse(custom); }
      return h({name:`${name}.eon-mesh.internal`, resolved:record||{type:'unresolved',url:''}});
    }

    if (path === '/v1/dns/list') {
      return h({count:8, message:'See /v3 for DNS records'});
    }

    // STORAGE
    if (path.startsWith('/v1/store/')) {
      const key = path.split('/v1/store/')[1];
      if (method === 'PUT') {
        const body = await request.text();
        const nodeId = request.headers.get('X-Node-Id') || 'unknown';
        const ts = Date.now();
        await env.MATRIX_KV.put(`data:${key}`, body, {metadata:{node_id:nodeId,timestamp:ts,content_type:request.headers.get('Content-Type')||'application/octet-stream'}});
        await env.MATRIX_KV.put(`idx:${key}`, JSON.stringify({key,node_id:nodeId,timestamp:ts,size:body.length}), {expirationTtl:86400*7});
        return h({status:'stored', key, timestamp:ts});
      }
      if (method === 'GET') {
        const r = await env.MATRIX_KV.getWithMetadata(`data:${key}`);
        if (!r || r.value===null) return h({error:'not found'}, 404);
        return h({key, value:r.value, metadata:r.metadata||{}});
      }
      if (method === 'DELETE') {
        await Promise.all([env.MATRIX_KV.delete(`data:${key}`), env.MATRIX_KV.delete(`idx:${key}`)]);
        return h({status:'deleted', key});
      }
    }

    if (path === '/v1/list') {
      const prefix = url.searchParams.get('prefix')||'';
      const kl = await env.MATRIX_KV.list({prefix:`idx:${prefix}`, limit:100});
      const items = [];
      for (const k of (kl.keys||[])) {const v=await env.MATRIX_KV.get(k.name); if(v) items.push(JSON.parse(v));}
      return h({items, count:items.length});
    }

    // ─── RING 2: EDGE ──────────────────────────────────
    // WATCHER
    if (path === '/v1/watch/ping' && method === 'POST') {
      const body = await request.json();
      const entry = {node:body.node_id||'unknown', status:'healthy', latency:body.latency||0, timestamp:Date.now()};
      await env.MATRIX_KV.put(`health:${entry.node}`, JSON.stringify(entry), {expirationTtl:600});
      return h(entry);
    }

    if (path === '/v1/watch/status') {
      const kl = await env.MATRIX_KV.list({prefix:'health:'});
      const nodes = [];
      for (const k of (kl.keys||[])) {const v=await env.MATRIX_KV.get(k.name); if(v) nodes.push(JSON.parse(v));}
      return h({watched:nodes, count:nodes.length, healthy:nodes.filter(n=>n.status==='healthy').length});
    }

    // QUEUE
    if (path === '/v1/queue/push' && method === 'POST') {
      const body = await request.json();
      const qid = `q:${Date.now()}:${Math.random().toString(36).slice(2,6)}`;
      await env.MATRIX_KV.put(qid, JSON.stringify({...body, id:qid, status:'pending', created:Date.now()}), {expirationTtl:86400});
      return h({queued:qid});
    }

    if (path === '/v1/queue/pop' && method === 'POST') {
      const kl = await env.MATRIX_KV.list({prefix:'q:', limit:10});
      for (const k of (kl.keys||[])) {
        const v = await env.MATRIX_KV.get(k.name);
        if (v) {
          const item = JSON.parse(v);
          if (item.status === 'pending') {
            item.status = 'processing';
            await env.MATRIX_KV.put(k.name, JSON.stringify(item), {expirationTtl:86400});
            return h(item);
          }
        }
      }
      return h({error:'queue empty'}, 404);
    }

    return h({error:'route not found'}, 404);
  }
};
