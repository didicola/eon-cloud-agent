// brain-bridge.js — regenerated EON semantic memory/cache bridge
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_DIR = path.join(process.env.HOME || '/root', '.eon-brain-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'responses.json');

let _cache = null;
let _hits = 0;
let _misses = 0;

function _load() {
  if (_cache) return _cache;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    _cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
  } catch (e) { _cache = {}; }
  return _cache;
}

function _persist() {
  try {
    if (_cache) fs.writeFileSync(CACHE_FILE, JSON.stringify(_cache));
  } catch (e) {}
}

function _hash(messages, model) {
  const last = messages[messages.length - 1];
  const text = (last?.content || JSON.stringify(messages)) + '|' + (model || '');
  let h = 0;
  for (let i = 0; i < text.length; i++) { h = ((h << 5) - h) + text.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

// ─── Semantic cache check ───
function checkBrainCache(model, messages) {
  try {
    const c = _load();
    const k = _hash(messages, model);
    const hit = c[k];
    if (hit && hit.expiresAt > Date.now()) { _hits++; return hit.value; }
    if (hit) delete c[k];
    _misses++;
    return null;
  } catch (e) { return null; }
}

// ─── Store response in semantic cache ───
function storeBrainCache(model, messages, content) {
  try {
    if (!content) return;
    const c = _load();
    const k = _hash(messages, model);
    c[k] = { value: content, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    // Keep cache bounded
    const keys = Object.keys(c);
    if (keys.length > 5000) { for (let i = 0; i < 500; i++) delete c[keys[i]]; }
    _persist();
  } catch (e) {}
}

function getCacheStats() {
  _load();
  let totalTokens = 0;
  const keys = _cache ? Object.keys(_cache) : [];
  for (const k of keys) totalTokens += (_cache[k]?.value?.length || 0) / 4;
  return {
    entries: keys.length,
    hits: _hits,
    misses: _misses,
    hit_rate: (_hits + _misses) > 0 ? (Math.round(_hits / (_hits + _misses) * 100)) : 0,
    approx_tokens_saved: Math.round(totalTokens),
    storage: CACHE_FILE
  };
}

module.exports = { checkBrainCache, storeBrainCache, getCacheStats };
