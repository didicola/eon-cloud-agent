#!/usr/bin/env node
/*
 * EON permanent coordination matrix daemon (DnA-upgrade 2026-07-31)
 * - 60s round-robin: AI Cloud (8303/8304/8081) <-> AI Web (eon-site) <-> Termux bridge
 * - writes state JSON + markdown to commands/eo-coordineon_MATRIX.{"md","json"}
 * - localhost + HTTP /status endpoint on :8095 (guard-allowed)
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const { execFile } = require("child_process");

const PORT = parseInt(process.env.EON_MCP_PORT || "8095");
const HOME = process.env.EON_HOME || process.env.HOME || "/home/ricos";
const OUT = HOME + "/eon-cloud-agent/commands/eo-coordineon_MATRIX.md";
const OUT_JSON = HOME + "/eon-cloud-agent/commands/eo-coordineon_MATRIX.json";

function ping(u) {
  if (u.startsWith("https://")) {
    // Guard §2.2: outbound must go through Tor SOCKS — use curl --socks5-hostname
    return new Promise(r => {
      const t = Date.now();
      execFile("curl", ["-s","--socks5-hostname","127.0.0.1:9050","--max-time","8",
        "-o","/dev/null","-w","%{http_code}", u], (err, stdout) => {
        if (err) return r({ target: u, ok: false, err: String(err).slice(0,80) });
        const code = parseInt(String(stdout).trim() || "0");
        r({ target: u, code, ok: code >= 200 && code < 400, ms: Date.now() - t });
      });
    });
  }
  const lib = u.startsWith("https") ? https : http;
  return new Promise(r => {
    try {
      const t = Date.now();
      lib.get(u, res => r({ target: u, code: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400, ms: Date.now() - t })).on("error", e => r({ target: u, ok: false, err: String(e).slice(0,80) }));
      setTimeout(() => r({ target: u, ok: false, err: "timeout" }), 6000);
    } catch (e) { r({ target: u, ok: false, err: String(e).slice(0,80) }); }
  });
}

const C = {
  cloud: ["http://127.0.0.1:8303/health", "http://127.0.0.1:8304/health", "http://127.0.0.1:8081/health"],
  web:  ["https://eon-site.exportdefaultasyncfetchrequestenvconsturl.workers.dev/api/health"],
  p2p:  ["https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/health"]
};

async function tick() {
  const all = await Promise.all([...C.cloud, ...C.web, ...C.p2p].map(ping));
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  let s = `# AI Cloud <-> Web <-> Termux Coordination Matrix  (tick: ${ts})\n`;
  s += all.map(x => "- " + x.target + " -> " + (x.ok ? "UP (" + x.code + ")" : "DOWN " + (x.err || x.code))).join("\n") + "\n";
  s += "- next tick in 60s (self-healing)\n";
  try {
    fs.writeFileSync(OUT, s);
    fs.writeFileSync(OUT_JSON, JSON.stringify({ tick: ts, surfaces: all }, null, 2));
    console.log("[" + ts + "] matrix tick -> " + OUT_JSON);
  } catch (e) {
    fs.writeFileSync("/tmp/eo-coordineon_MATRIX.md", s);
    fs.writeFileSync("/tmp/eo-coordineon_MATRIX.json", JSON.stringify({ tick: ts, surfaces: all }, null, 2));
    console.log("[" + ts + "] matrix tick -> /tmp fallback (" + e + ")");
  }
}

tick();
setInterval(tick, 60000);

http.createServer((q, s) => {
  if (q.url === "/status") s.end("eon matrix up " + new Date().toISOString() + " tick=" + OUT_JSON);
  else { s.statusCode = 404; s.end("matrix relay — see commands/eo-coordineon_MATRIX.*"); }
}).listen(PORT, "127.0.0.1");
