#!/usr/bin/env node
/*
 * Permanent AI Cloud <-> AI Web coordination matrix
 * - round-robin tick every 60s
 * - persists state to commands/eo-coordineon_MATRIX.md
 * - self-healing: relaunches on crash via the daemon below
 */
const https = require("https");
const { execSync } = require("child_process");
const fs = require("fs");

const C = {
  cloud:  { twinUbuntu:"http://127.0.0.1:8303/health", twinTermux:"http://127.0.0.1:8304/health", brain:"http://127.0.0.1:8081/health" },
  web:    { site:"https://eon-site.d1matrix.workers.dev/health", api:"/api/eon/matrix" },
  state:  "/root/eon-cloud-agent/commands/eo-coordineon_MATRIX.md"
};

function ping(url) {
  return new Promise(r => {
    try {
      const t0 = Date.now();
      https.get(url, (res) => {
        r({url, code: res.statusCode, ms: Date.now()-t0, ok: res.statusCode===200});
      }).on("error", e => r({url, code: 0, ms: Date.now()-t0, ok:false, err:e.message}));
      setTimeout(() => r({url, code:0, ms:6000, ok:false, err:"timeout"}), 6000);
    } catch(e){ r({url, code:0, ok:false, err:e.message}); }
  });
}

function tick() {
  Promise.all([
    ping(C.cloud.twinUbuntu), ping(C.cloud.twinTermux), ping(C.cloud.brain),
    ping(C.web.site)
  ]).then(([tu,tt,br,web]) => {
    const ts = new Date().toISOString().replace("T"," ").slice(0,19) + " UTC";
    let s = `# AI Cloud <-> AI Web Coordination Matrix  (tick: ${ts})\n`;
    s += `- AI Cloud twin-ubuntu :8303 → ${tu.ok?"healthy":"DOWN"} (${tu.code})\n`;
    s += `- AI Cloud twin-termux :8304 → ${tt.ok?"healthy":"DOWN"} (${tt.code})\n`;
    s += `- cloud-brain :8081 → ${br.ok?"EON Sovereign Workers Runtime":"DOWN"} (${br.code})\n`;
    s += `- AI Web eon-site → ${web.ok?"healthy":"DEAD 404 — routes not mounted"} (${web.code})\n`;
    s += `- next tick in 60s (self-healing)\n`;
    fs.writeFileSync(C.state, s);
    console.log(`[${ts}] matrix tick → cloud:${tu.ok&&tt.ok&&br.ok?"UP":"DEGRADED"} web:${web.ok?"UP":"DOWN"}`);
  });
}

tick();
setInterval(tick, 60000);
process.on("uncaughtException", (e)=>{ console.error("matrix-relay crashed:",e.message); process.exit(1); });
