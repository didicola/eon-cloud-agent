// matrix-proxy.js — regenerated EON matrix health/routing library
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');

// ─── Matrix nodes (Termux + twin nodes) ───
// 8090 blind-proxy, 8201 matrix brain, 8095 matrix-relay are local.
// 8303/8304/8081 are the ubuntu twin's AI-Cloud/edge ports (DOWN here, expected).
const MATRIX_NODES = [
  { name: 'termux-matrix', url: 'http://127.0.0.1:8201', role: 'brain', healthy: false },
  { name: 'blind-proxy', url: 'http://127.0.0.1:8090', role: 'router', healthy: false },
  { name: 'matrix-relay', url: 'http://127.0.0.1:8095', role: 'relay', healthy: false },
  { name: 'eon-alpha', url: 'http://127.0.0.1:8081', role: 'edge', healthy: false },
  { name: 'eon-beta', url: 'http://127.0.0.1:8303', role: 'cloud', healthy: false },
  { name: 'eon-gamma', url: 'http://127.0.0.1:8304', role: 'cloud', healthy: false }
];

let _lastProbe = 0;
let _headroom = { cpu: 0, mem: 0, load: 0 };

function _probe(urlStr, timeoutMs) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: '/health', method: 'GET', timeout: timeoutMs || 3000,
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' } }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode, body: d.substring(0, 200) }));
      });
      req.setTimeout(timeoutMs || 3000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

async function probeMatrixHealth() {
  const results = await Promise.all(MATRIX_NODES.map(n => _probe(n.url)));
  MATRIX_NODES.forEach((n, i) => {
    n.healthy = !!results[i].ok;
    n.status = results[i].status || results[i].error || '?';
    n.checkedAt = Date.now();
  });
  return MATRIX_NODES;
}

function getMatrixHealth() {
  if (Date.now() - _lastProbe > 10000) {
    probeMatrixHealth();
    _lastProbe = Date.now();
  }
  return {
    nodes: MATRIX_NODES.map(n => ({ name: n.name, url: n.url, role: n.role, healthy: n.healthy, status: n.status || 'unknown' })),
    healthy_count: MATRIX_NODES.filter(n => n.healthy).length,
    total: MATRIX_NODES.length,
    topology: 'termux:8201 -> blind-proxy:8090 -> cloud-workers'
  };
}

// ─── Route a request through the matrix (graph-based) ───
async function routeViaMatrix(parsed, wantsStream, res) {
  // Termux matrix brain answers locally through the same proxy chain; if the local
  // brain (:8201) is healthy, delegate. Otherwise report clean miss so the caller's
  // other fallbacks (local-brain) take over.
  try {
    const local = MATRIX_NODES.find(n => n.name === 'termux-matrix');
    const probe = await _probe('http://127.0.0.1:8201/v1/models');
    if (probe.ok) {
      if (wantsStream) {
        const { routeZeroTokenStream } = require('./zero-token-router.js');
        const chunks = await routeZeroTokenStream(parsed.messages, parsed.model);
        if (chunks && chunks.length) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
          return { ok: true, via: 'matrix', node: 'termux-matrix' };
        }
      }
      const { askLocal } = require('./local-brain.js');
      const answer = await askLocal(parsed.messages, { max_tokens: parsed.max_tokens || 512, timeout: 30000, temperature: parsed.temperature || 0.7 });
      if (answer) {
        res._responseSent = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'matrix-' + Date.now(), object: 'chat.completion', model: 'matrix', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
        return { ok: true, via: 'matrix', node: 'termux-matrix' };
      }
    }
    return { ok: false, reason: 'matrix-node-down' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ─── Tor helpers ───
function _readTorIp() {
  try {
    const data = fs.existsSync('/tmp/tor_ip.txt') ? fs.readFileSync('/tmp/tor_ip.txt', 'utf8').trim() : '';
    return data || null;
  } catch (e) { return null; }
}

function getTorIP() {
  const cached = _readTorIp();
  if (cached) return cached;
  // Fallback: query Tor control via SOCKS (best-effort)
  try {
    const net = require('net');
    return new Promise((resolve) => {
      const sock = net.connect(9050, '127.0.0.1', () => {
        // SOCKS5 CONNECT to a resolve-allowing endpoint to learn exit IP
        const req = Buffer.from([0x05, 0x01, 0x00, 0x03, 0x0c, ...Buffer.from('checkip.amazonaws.com'), 0x00, 0x50]);
        sock.write(req);
      });
      sock.setTimeout(3000);
      sock.on('timeout', () => { sock.destroy(); resolve(null); });
      sock.on('error', () => resolve(null));
      let buf = Buffer.alloc(0);
      sock.on('data', d => {
        buf = Buffer.concat([buf, d]);
        if (buf.length >= 10 && buf[0] === 0x05 && buf[1] === 0x00) {
          sock.destroy();
          const ip = _readTorIp();
          resolve(ip || 'tor-exit');
        }
      });
    });
  } catch (e) { return null; }
}

function rotateTorIP() {
  try {
    const { execSync } = require('child_process');
    execSync('printf "AUTHENTICATE\\r\\nSIGNAL NEWNYM\\r\\n" | nc 127.0.0.1 9051 2>/dev/null || true', { timeout: 5000, stdio: 'ignore' });
  } catch (e) {}
  try {
    const { execSync } = require('child_process');
    const ip = execSync('timeout 8 curl -s --socks5-hostname 127.0.0.1:9050 https://ifconfig.me 2>/dev/null || true', { timeout: 10000, encoding: 'utf8' }).toString().trim();
    if (ip) fs.writeFileSync('/tmp/tor_ip.txt', ip);
    return ip || null;
  } catch (e) { return null; }
}

function getHeadroomStats() {
  try {
    const cpus = os.cpus();
    const load = os.loadavg()[0] || 0;
    const mem = (os.totalmem() - os.freemem()) / os.totalmem();
    _headroom = { cpu: Math.min(100, Math.round(load / Math.max(1, cpus.length) * 100)), mem: Math.round(mem * 100), load };
  } catch (e) {}
  return _headroom;
}

module.exports = { getMatrixHealth, routeViaMatrix, rotateTorIP, getTorIP, getHeadroomStats, MATRIX_NODES, probeMatrixHealth };
