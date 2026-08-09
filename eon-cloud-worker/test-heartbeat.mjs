// ═══════════════════════════════════════════════════════════════════════
// EON DEAD-MAN'S SWITCH — LOCAL-OFF SIMULATION TEST
//
// Proves the 24/7 Sovereign Loop:
//   PHASE A (local alive)  -> probe answers, misses reset, no dispatch
//   PHASE B (local DIES)   -> N consecutive misses => genesis dispatch fires
//   PHASE C (local back)   -> stop dispatch fires, genesis cedes control
//
// Run:  node test-heartbeat.mjs
// Uses a Map-backed KV mock + an unreachable mesh URL; GENESIS_DRYRUN logs
// the exact workflow_dispatch command instead of hitting GitHub.
// ═══════════════════════════════════════════════════════════════════════
import { heartbeatTick, initialState } from './heartbeat.js';

class MockKV {
  constructor() { this.m = new Map(); }
  async get(key, type) {
    const v = this.m.get(key);
    return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v);
  }
  async put(key, val) { this.m.set(key, val); }
}

function assert(name, cond) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name);
  if (!cond) process.exitCode = 1;
}

const kv = new MockKV();
const env = {
  EON_MESH_URL: 'http://127.0.0.1:59999/dead', // unreachable = local machine destroyed
  GENESIS_MISSES: '2',
  GENESIS_COOLDOWN_MIN: '1',
  GENESIS_REPO: 'didicola/eon-cloud-agent',
  GENESIS_WORKFLOW: 'eon-genesis.yml',
  GENESIS_DRYRUN: '1', // simulate the dispatch; log instead of POSTing
};

console.log('=== PHASE A: local bridge ALIVE ===');
const envA = { ...env, EON_MESH_URL: 'http://127.0.0.1:8787/api/health' };
let r = await heartbeatTick(kv, envA);
assert('state.localAlive == true', r.state.localAlive === true);
assert('misses == 0', r.state.misses === 0);
assert('no genesis action', r.action === 'none');

console.log('=== PHASE B: local machine DESTROYED (bridge dead) ===');
r = await heartbeatTick(kv, env); // miss #1
assert('tick 1: localAlive == false', r.state.localAlive === false);
assert('tick 1: misses == 1', r.state.misses === 1);
r = await heartbeatTick(kv, env); // miss #2 -> trigger
assert('tick 2: misses == 2', r.state.misses === 2);
assert('tick 2: GENESIS TRIGGERED', r.action === 'trigger(dryrun)');
assert('genesisActive == true', r.state.genesisActive === true);
assert('lastGenesisAt set', r.state.lastGenesisAt > 0);

console.log('=== PHASE C: local bridge RECONNECTS ===');
r = await heartbeatTick(kv, envA);
assert('localAlive == true again', r.state.localAlive === true);
assert('misses reset to 0', r.state.misses === 0);
assert('STOP dispatched (ephemeral cedes control)', r.action === 'stop(dryrun)');
assert('genesisActive == false', r.state.genesisActive === false);
assert('genesisEpoch incremented', r.state.genesisEpoch === 1);

console.log('=== PHASE D: anti-storm cooldown respected ===');
r = await heartbeatTick(kv, env); // dead again, immediately after stop
assert('no instant re-trigger (cooldown 0-min guard, epoch gate)', r.action !== 'trigger(dryrun)');

console.log('\nResult: ' + (process.exitCode ? 'FAIL' : 'PASS'));
process.exit(process.exitCode || 0);
