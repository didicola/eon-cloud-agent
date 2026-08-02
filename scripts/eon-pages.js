#!/usr/bin/env node
// EON Pages — sovereign web hosting tier for EonHub.
// Serves HF-style model hub (/hf/) and Cloudflare-style static sites (/site/:name/*)
// with the EON cloud store as origin (source of truth lives in the cloud).
'use strict';
const http = require('http');
const https = require('https');

const PORT = process.env.EON_PAGES_PORT || 8080;
const CLOUD = process.env.EON_CLOUD_URL || 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const UA = 'eon-pages/1.0';
const cache = new Map();

function log() { console.error('[eon-pages]', ...arguments); }

function fetchUpstream(urlStr, method, headers, body, retries) {
  const maxRetries = retries === undefined ? 4 : retries;
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      let u; try { u = new URL(urlStr); } catch (e) { reject(e); return; }
      const mod = u.protocol === 'https:' ? https : http;
      const opts = {
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: method || 'GET',
        headers: Object.assign({ 'User-Agent': UA, 'Connection': 'close' }, headers || {})
      };
      let done = false;
      let retrying = false;
      const settle = (fn, v) => { if (!done) { done = true; fn(v); } };
      const retry = (why) => {
        if (retrying || done) return;
        retrying = true;
        if (n < maxRetries) { log('retry ' + urlStr + ' ' + why + ' (' + (n + 1) + ')'); setTimeout(() => attempt(n + 1), 700); }
        else reject(new Error(why));
      };
      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 500 || res.statusCode === 429) return retry('status ' + res.statusCode);
          settle(resolve, { status: res.statusCode, body: data, headers: res.headers });
        });
      });
      req.setTimeout(12000, () => { req.destroy(); retry('timeout'); });
      req.on('error', e => retry(e.code || 'error'));
      if (body) req.write(body);
      req.end();
    };
    attempt(0);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject'
};

function contentTypes(path) {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return 'text/html; charset=utf-8';
  return MIME[path.slice(idx).toLowerCase()] || 'application/octet-stream';
}

async function cloudGetSite(name, relPath) {
  const rel = relPath || 'index.html';
  const candidates = [
    'site/' + name + '/' + rel,
    name + '/' + rel,
    'site/site/' + name + '/' + rel,
    'site/' + name + '/' + rel.replace(/^site\//, ''),
    name + '/' + rel.replace(/^site\//, '')
  ];
  for (const key of candidates) {
    const url = CLOUD + '/sync/config?type=site&key=' + encodeURIComponent(key);
    const res = await fetchUpstream(url);
    if (res.status !== 200) continue;
    try {
      const d = JSON.parse(res.body);
      if (!d.found) continue;
      return Buffer.from(d.value, 'base64');
    } catch (e) { continue; }
  }
  return null;
}

async function cloudListSites() {
  const url = CLOUD + '/sync/config?type=site&key=' + encodeURIComponent('__list__');
  const res = await fetchUpstream(url);
  try { const d = JSON.parse(res.body); if (d.found) return JSON.parse(Buffer.from(d.value, 'base64').toString()); } catch (e) {}
  return [];
}

let modelsCache = { at: 0, data: null };
async function cloudModels() {
  if (modelsCache.data && Date.now() - modelsCache.at < 120000) return modelsCache.data;
  log('cloudModels: fetching', CLOUD + '/v1/models');
  const res = await fetchUpstream(CLOUD + '/v1/models');
  log('cloudModels: status', res && res.status);
  if (res.status !== 200) return modelsCache.data || [];
  try {
    const data = JSON.parse(res.body).data || [];
    modelsCache = { at: Date.now(), data };
    return data;
  } catch (e) { log('cloudModels parse err', e.message); return modelsCache.data || []; }
}

async function serveSite(name, relPath, res) {
  if (!name) {
    const sites = await cloudListSites();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSiteIndex(sites));
    return;
  }
  const ck = 'site:' + name + ':' + (relPath || 'index.html');
  let body = cache.get(ck);
  if (!body) {
    body = await cloudGetSite(name, relPath);
    if (!body) {
      // default to index.html when a sub-path is requested
      body = await cloudGetSite(name, '');
      if (body && relPath) { body = null; }
    }
    if (body) cache.set(ck, body);
  }
  if (!body) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 — site not found</h1><p>EonHub site <b>' + name + '</b> does not exist.</p><p><a href="/site/">Browse all sites</a></p>');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentTypes(relPath || 'index.html'), 'Cache-Control': 'public, max-age=60' });
  res.end(body);
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function renderSiteIndex(sites) {
  const rows = sites.map(s => '<li><a href="/site/' + esc(s.name) + '/"><b>' + esc(s.name) + '</b></a> <span style="opacity:.6">' + esc(s.desc || '') + '</span></li>').join('\n');
  return page('EonHub · Sites', '<h1>EonHub Pages</h1><p>Sovereign static site hosting, cloud-store origin.</p><ul>' + (rows || '<li style="opacity:.5">No sites yet</li>') + '</ul>');
}

async function serveHF(res) {
  const models = await cloudModels();
  const groups = {};
  for (const m of models) {
    const fam = (m.id || 'model').split(/[-/]/)[0];
    (groups[fam] = groups[fam] || []).push(m);
  }
  let cards = '';
  for (const fam of Object.keys(groups).sort()) {
    const ms = groups[fam];
    cards += '<section style="margin:18px 0"><h3 style="text-transform:capitalize">' + esc(fam) + ' (' + ms.length + ')</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px">';
    for (const m of ms.slice(0, 12)) {
      cards += '<div style="background:#121826;border:1px solid #1f2a3a;border-radius:10px;padding:10px"><b>' + esc(m.id) + '</b><div style="opacity:.6;font-size:12px">' + esc(m.provider || 'eon') + ' · ' + (m.cost || '$0') + '</div></div>';
    }
    cards += '</div></section>';
  }
  const html = '<h1>EON HF Hub</h1><p>Sovereign model hub — ' + models.length + ' models served by the EON cloud matrix.</p>' + (cards || '<p style="opacity:.5">No models</p>');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page('EON HF Hub', html));
}

function page(title, bodyHtml) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>' + esc(title) + '</title><style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0a0e14;color:#e6edf3}a{color:#36e0a0;text-decoration:none}a:hover{text-decoration:underline}header{padding:14px 20px;border-bottom:1px solid #1f2a3a;display:flex;gap:16px;align-items:center}header .brand{font-weight:700;color:#36e0a0}header a{color:#8b98a8;font-size:14px}.wrap{max-width:960px;margin:0 auto;padding:20px}</style></head><body><header><span class="brand">EonHub</span><a href="/site/">Sites</a><a href="/hf/">HF Hub</a><a href="/">Home</a></header><div class="wrap">' + bodyHtml + '</div></body></html>';
}

function serveHome(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page('EonHub', '<h1>EonHub — sovereign web platform</h1><p>A parallel internet: model hub, static sites, and the EON cloud matrix — zero-cost, anonymous, cloud-store origin.</p><p><a href="/hf/">EON HF Hub</a> · <a href="/site/">EON Pages</a></p>'));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  log(u.method, p);
  try {
    if (p === '/' || p === '/index.html') return await serveHome(res);
    if (p === '/hf' || p === '/hf/' || p.startsWith('/hf/')) return await serveHF(res);
    if (p === '/site' || p === '/site/') return await serveSite('', '', res);
    if (p.startsWith('/site/')) {
      const parts = p.slice('/site/'.length).split('/').filter(Boolean);
      const name = parts[0];
      const rel = parts.slice(1).join('/');
      return await serveSite(name, rel, res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('EON Pages: 404 not found\n');
  } catch (e) {
    log('error', e.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('EON Pages: 500 ' + e.message + '\n');
    } else {
      res.end();
    }
  }
});

process.on('unhandledRejection', (e) => { log('unhandledRejection', (e && e.message) || e); });

server.listen(PORT, () => {
  log('EON Pages :' + PORT + ' — /hf hub, /site static hosting, origin=' + CLOUD);
});
