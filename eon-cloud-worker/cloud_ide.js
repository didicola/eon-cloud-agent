// ═══════════════════════════════════════════════════════════════════════
// EON CLOUD IDE — Pure Dark Matter (serverless) IDE organ
//
// The entire IDE lives at the Cloudflare edge. State is Cloudflare KV +
// D1 (no local filesystem, no local database). Heavy compute (exec) is
// delegated to ephemeral genesis VMs through the mesh work queue: the edge
// enqueues a task, a genesis VM pulls + runs + posts the result, and the
// IDE polls /api/ide/exec/status to stream it back. Works with every local
// machine switched off.
//
// Zero earthly dependencies: no loopback addresses, no local paths, no
// hardcoded IPs.
// ═══════════════════════════════════════════════════════════════════════

const IDE_VERSION = '10.0-dark-matter-ide';

function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

async function kvGet(kv, key, fb = null) {
  try {
    const v = await kv.get(key, 'json');
    return v === null || v === undefined ? fb : v;
  } catch {
    return fb;
  }
}

async function kvPut(kv, key, val) {
  try {
    await kv.put(key, JSON.stringify(val));
  } catch {}
}

// D1 table bootstrap — run once via /api/ide/bootstrap
async function ensureD1(d1) {
  if (!d1) return false;
  try {
    await d1.exec('CREATE TABLE IF NOT EXISTS ide_files (path TEXT PRIMARY KEY, content TEXT, mime TEXT, at INTEGER)');
    await d1.exec('CREATE TABLE IF NOT EXISTS ide_sessions (id TEXT PRIMARY KEY, node TEXT, at INTEGER, status TEXT)');
    return true;
  } catch {
    return false;
  }
}

async function d1Get(d1, path) {
  if (!d1) return null;
  try {
    const res = await d1.prepare('SELECT path, content, mime, at FROM ide_files WHERE path = ?').bind(path).first();
    return res || null;
  } catch {
    return null;
  }
}

async function d1Put(d1, path, content, mime) {
  if (!d1) return false;
  try {
    await d1.prepare(
      'INSERT OR REPLACE INTO ide_files (path, content, mime, at) VALUES (?, ?, ?, ?)'
    ).bind(path, content, mime, Date.now()).run();
    return true;
  } catch {
    return false;
  }
}

export async function handleIde(request, url, kv, d1, env = {}) {
  const p = url.pathname;

  // ── Static serverless IDE UI ──
  if (p === '/ide' || p === '/ide/') {
    return new Response(`<!doctype html><html><head><meta charset="utf-8">
<title>EON Cloud IDE</title><style>
body{font-family:monospace;background:#0b0e14;color:#d4d4d4;margin:0;padding:24px}
h1{color:#7ee787;font-size:18px}
.box{background:#161b27;border:1px solid #30363d;border-radius:6px;padding:16px;margin:12px 0}
input,textarea{width:100%;background:#0b0e14;color:#d4d4d4;border:1px solid #30363d;border-radius:4px;padding:8px;font-family:monospace}
button{background:#238636;color:#fff;border:0;border-radius:4px;padding:8px 14px;cursor:pointer}
pre{background:#0b0e14;border:1px solid #30363d;border-radius:4px;padding:8px;overflow:auto}
.small{color:#8b949e;font-size:12px}
</style></head><body>
<h1>EON Cloud IDE — Pure Dark Matter (serverless, 24/7)</h1>
<div class="small">State: Cloudflare KV + D1 · Heavy exec: ephemeral genesis VMs · Works with all local boxes off</div>
<div class="box"><h1>Session</h1><button onclick="session()">Create session</button>
<pre id="session"></pre></div>
<div class="box"><h1>File (KV+D1 backed)</h1>
<input id="path" value="main.py" /><textarea id="content" rows="6"></textarea>
<button onclick="save()">Save</button> <button onclick="load()">Load</button>
<pre id="file"></pre></div>
<div class="box"><h1>Execute (delegated to ephemeral genesis VM)</h1>
<textarea id="code" rows="6" placeholder="python3 -c 'print(2+2)'"></textarea>
<button onclick="run()">Run</button>
<pre id="exec"></pre></div>
<script>
async function call(u, o){const r=await fetch(u,o);return r.json();}
async function session(){const d=await call('/api/ide/session',{method:'POST'});document.getElementById('session').textContent=JSON.stringify(d,null,2);}
async function save(){const p=document.getElementById('path').value;const c=document.getElementById('content').value;
  document.getElementById('file').textContent=JSON.stringify(await call('/api/ide/files/'+p,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})}),null,2);}
async function load(){const p=document.getElementById('path').value;
  const d=await call('/api/ide/files/'+p);document.getElementById('file').textContent=JSON.stringify(d,null,2);}
async function run(){const code=document.getElementById('code').value;
  const d=await call('/api/ide/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:code})});
  document.getElementById('exec').textContent=JSON.stringify(d,null,2);
  if(d.ok){const t=setInterval(async()=>{const s=await call('/api/ide/exec/status/'+d.id);
    document.getElementById('exec').textContent=JSON.stringify(s,null,2);
    if(s.status==='done'||s.status==='error')clearInterval(t);},3000);}
}
</script></body></html>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── Session ──
  if (p === '/api/ide/session' && request.method === 'POST') {
    const id = 'sess-' + Date.now().toString(36);
    if (d1) {
      try {
        await d1.prepare('INSERT OR REPLACE INTO ide_sessions (id, node, at, status) VALUES (?, ?, ?, ?)')
          .bind(id, 'edge', Date.now(), 'open').run();
      } catch {}
    } else {
      const sessions = await kvGet(kv, 'ide:sessions', []);
      sessions.push({ id, at: Date.now() });
      await kvPut(kv, 'ide:sessions', sessions.slice(-50));
    }
    return j({ ok: true, id, storage: d1 ? 'd1' : 'kv', version: IDE_VERSION });
  }

  // ── Files (D1 primary, KV mirror) ──
  if (p.startsWith('/api/ide/files/')) {
    const path = decodeURIComponent(p.slice('/api/ide/files/'.length));
    if (request.method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      let ok = false;
      if (d1) ok = await d1Put(d1, path, body.content || '', 'text/plain');
      await kvPut(kv, 'ide:file:' + path, { path, content: body.content || '', at: Date.now() });
      return j({ ok: true, path, storage: ok ? 'd1' : 'kv' });
    }
    const row = await d1Get(d1, path);
    const kvRow = await kvGet(kv, 'ide:file:' + path, null);
    return j({ ok: true, path, content: (row && row.content) || (kvRow && kvRow.content) || '', storage: row ? 'd1' : 'kv' });
  }

  // ── Exec → enqueue for ephemeral genesis VM (edge stays the orchestrator) ──
  if (p === '/api/ide/exec' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const work = await kvGet(kv, 'mesh:queue', []);
    const id = 'ide-' + Date.now().toString(36);
    work.push({ id, type: 'ide-exec', payload: { cmd: body.cmd || '' }, createdAt: Date.now() });
    await kvPut(kv, 'mesh:queue', work.slice(-50));
    await kvPut(kv, 'ide:exec:' + id, { id, status: 'queued', at: Date.now() });
    return j({ ok: true, id, status: 'queued', note: 'delegated to ephemeral genesis VM' });
  }

  if (p.startsWith('/api/ide/exec/status/')) {
    const id = decodeURIComponent(p.slice('/api/ide/exec/status/'.length));
    const results = await kvGet(kv, 'mesh:results', []);
    const hit = (results || []).find((r) => r && r.id === id);
    const st = await kvGet(kv, 'ide:exec:' + id, { status: 'unknown' });
    return j({ id, status: hit ? 'done' : st.status, result: hit ? hit.note || hit : null });
  }

  if (p === '/api/ide/bootstrap' && request.method === 'POST') {
    const ok = await ensureD1(d1);
    return j({ ok, d1: ok ? 'ready' : 'unavailable' });
  }

  return j({ ok: false, error: 'unknown ide route: ' + p }, 404);
}
