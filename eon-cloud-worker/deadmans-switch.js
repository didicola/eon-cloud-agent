// ═══════════════════════════════════════════════════════════════════════
// EON DEAD MAN'S SWITCH — standalone Cloudflare Worker
// Runs on its own cron (every 2 minutes). Pings the local mesh bridge /
// Tor onion endpoint. If it is dead for 2 consecutive pings, the Worker
// INSTANTLY commands EON-Wrangler to spawn an ephemeral cloud VM so the
// system never goes offline. When local reconnects, it dispatches a stop.
//
// This is the pure cloud-side failover: it works even if every local
// machine is destroyed. Reuses the Sovereign Heartbeat module.
// ═══════════════════════════════════════════════════════════════════════

import { heartbeatTick, handleApi } from './heartbeat.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok', role: 'dead-mans-switch', platform: '100% cloud', uptime: 'permanent',
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    return handleApi(request, url, env.EON_KV, env);
  },

  // Cron every 2 minutes — the Sovereign Heartbeat runs the dead-man's logic.
  async scheduled(event, env) {
    await heartbeatTick(env.EON_KV, env);
  },
};
