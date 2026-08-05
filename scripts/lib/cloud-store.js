#!/usr/bin/env node
// cloud-store — permanent multi-channel store for the EON cloud matrix.
// Solves the ai-cloud-space KV free-tier DAILY WRITE LIMIT (403 / ok:false on /sync/config):
//   - every put() mirrors the value to BOTH /sync/config (KV) AND /sync/memory (D1, unlimited)
//   - every get() reads KV first, then falls back to D1 memory
//   - D1 memory is the durable source of truth; KV is the fast/legacy mirror.
// WARNING: python urllib gets 403 (UA-blocked); always use fetchUpstream-style client.
'use strict';
const https = require('https');
const http = require('http');

const CLOUD = process.env.EON_CLOUD_URL || 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev';
const UA = 'eon-cloud-store/1.0';

function fetchRaw(urlStr, method, headers, body, retries) {
  const maxRetries = retries === undefined ? 3 : retries;
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      let u; try { u = new URL(urlStr); } catch (e) { reject(e); return; }
      const mod = u.protocol === 'https:' ? https : http;
      const opts = {
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: method || 'GET',
        headers: Object.assign({ 'User-Agent': UA, 'Connection': 'close' }, headers || {})
      };
      let done = false, retrying = false;
      const settle = (fn, v) => { if (!done) { done = true; fn(v); } };
      const retry = (why) => {
        if (retrying || done) return;
        retrying = true;
        if (n < maxRetries) setTimeout(() => attempt(n + 1), 700);
        else reject(new Error(why));
      };
      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 500 || res.statusCode === 429) return retry('status ' + res.statusCode);
          settle(resolve, { status: res.statusCode, body: data });
        });
      });
      req.setTimeout(20000, () => { req.destroy(); retry('timeout'); });
      req.on('error', e => retry(e.code || 'error'));
      if (body) req.write(body);
      req.end();
    };
    attempt(0);
  });
}

function memId(type, key) { return 'cfg:' + type + ':' + key; }

async function putMemory(type, key, value) {
  // value here is the RAW value string (already base64 when binary) OR plain text.
  // store full fidelity: keep as-is, flag base64 via a marker for binary payloads.
  const payload = JSON.stringify({ entries: [{ id: memId(type, key), title: 'config:' + type, content: value }] });
  try {
    const res = await fetchRaw(CLOUD + '/sync/memory', 'POST', { 'Content-Type': 'application/json' }, payload);
    if (res.status !== 200) return { ok: false, status: res.status, body: res.body };
    const d = JSON.parse(res.body);
    const r = (d.results || [])[0];
    return { ok: !!(d.synced && d.synced >= 1), status: res.status, body: res.body, id: r && r.id };
  } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
}

async function getMemory(type, key) {
  try {
    const res = await fetchRaw(CLOUD + '/sync/memory?limit=5&id=' + encodeURIComponent(memId(type, key)));
    if (res.status !== 200) return null;
    const d = JSON.parse(res.body);
    const es = d.entries || [];
    const hit = es.find(e => e.id === memId(type, key));
    return hit ? hit.content : null;
  } catch (e) { return null; }
}

// put: mirror to KV config (best-effort) + D1 memory (authoritative). ok = memory succeeded.
async function put(type, key, rawValue) {
  const kvRes = await fetchRaw(CLOUD + '/sync/config', 'POST',
    { 'Content-Type': 'application/json' },
    JSON.stringify({ items: [{ type, key, value: rawValue }] }));
  const memRes = await putMemory(type, key, rawValue);
  let kvOk = false;
  try { const d = JSON.parse(kvRes.body); kvOk = !!(d.synced && (d.results || [])[0] && (d.results || [])[0].ok); } catch (e) {}
  return { ok: memRes.ok, kvOk, memOk: memRes.ok, kvStatus: kvRes.status, memStatus: memRes.status };
}

// get: KV first (fast), then D1 memory (authoritative fallback).
async function get(type, key) {
  const kv = await fetchRaw(CLOUD + '/sync/config?type=' + encodeURIComponent(type) + '&key=' + encodeURIComponent(key));
  try {
    const d = JSON.parse(kv.body);
    if (d.found) return d.value;
  } catch (e) {}
  return await getMemory(type, key);
}

module.exports = { put, get, putMemory, getMemory, memId, CLOUD };
