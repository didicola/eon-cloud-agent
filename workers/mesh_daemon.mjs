#!/usr/bin/env node
// EON Shadow Mesh — Node5 Heartbeat Daemon
// Uses node fetch which bypasses Cloudflare bot protection
const MESH = 'https://eon-mesh-swarm.pleasant-bobble.workers.dev';
const NODE_ID = 'node5';
const INTERVAL = +process.argv[2] || 120;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const headers = {'User-Agent': UA, 'Content-Type': 'application/json'};
const json = r => r.json();
const post = (path, body) => fetch(`${MESH}${path}`, {
  method:'POST', headers, body: JSON.stringify(body)
}).then(json);
const get = (path) => fetch(`${MESH}${path}`, {headers}).then(json);

async function register() {
  const r = await post('/mesh/register?node_id='+NODE_ID, {
    node_id: NODE_ID, ip:'127.0.0.1',
    hostname: 'node5.eon.local',
    capabilities: ['compute','storage','relay','dns','matrix','messenger','timing','monero','cloud-brain']
  });
  console.error(`[mesh] Registered — ${r.peers} peers`);
}

async function heartbeat() {
  return post('/mesh/heartbeat?node_id='+NODE_ID, {node_id: NODE_ID});
}

async function checkMessages() {
  const r = await get(`/mesh/messages?node_id=${NODE_ID}`);
  for (const m of (r.messages||[]))
    console.error(`[mesh] MSG from ${m.from}: ${(m.payload||'').substring(0,100)}`);
}

import { existsSync } from 'fs';
import { execSync } from 'child_process';

async function syncPheromones() {
  try {
    const dbPath = '/mnt/fluid-cloud/cloud-opencode/pheromones.db';
    if (!existsSync(dbPath)) return;
    const out = execSync(
      `python3 -c "import sqlite3,json;c=sqlite3.connect('${dbPath}');`+
      `c.row_factory=sqlite3.Row;`+
      `rows=[dict(r) for r in c.execute('SELECT * FROM pheromones ORDER BY id DESC LIMIT 50')];`+
      `print(json.dumps(rows))"`, {encoding:'utf8', timeout:5000}
    );
    const rows = JSON.parse(out.trim());
    for (const row of rows) {
      await fetch(`${MESH}/store/pheromone/${row.id}`, {
        method:'PUT', headers: {...headers, 'X-Node-Id': NODE_ID},
        body: JSON.stringify(row)
      });
    }
    console.error(`[mesh] Synced ${rows.length} pheromones`);
  } catch(e) { console.error('[mesh] Sync error:', e.message); }
}

if (process.argv.includes('--register') || process.argv.includes('register') || process.argv.length < 3) {
  register().catch(e => console.error('[mesh] Register error:', e.message));
}
if (process.argv.includes('--dns')) {
  const name = process.argv[process.argv.indexOf('--dns')+1] || 'brain';
  get(`/dns/resolve/${name}.eon-mesh.internal`).then(d => console.log(JSON.stringify(d, null, 2)));
}
if (process.argv.includes('daemon') || process.argv.length < 3) {
  console.error(`[mesh] Starting daemon for ${NODE_ID} (${INTERVAL}s)`);
  register().then(() => {
    syncPheromones();
    let cycle = 0;
    setInterval(async () => {
      try {
        cycle++;
        await heartbeat();
        if (cycle % 5 === 0) {
          const p = await get(`/mesh/peers?node_id=${NODE_ID}`);
          console.error(`[mesh] ${(p.peers||[]).length} peers online`);
        }
        await checkMessages();
      } catch(e) { console.error('[mesh] Cycle error:', e.message); }
    }, INTERVAL * 1000);
  });
}
