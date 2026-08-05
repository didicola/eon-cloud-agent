// challenge-rotator.js — regenerated EON anti-detection/identity-rotation library
// Restored 2026-08-02 for blind-proxy-full.js. Self-contained, no external deps.

const crypto = require('crypto');

// ─── Challenge detection ───
function isChallenge(statusCode, body) {
  if (!body) return statusCode === 403 || statusCode === 429;
  const s = String(body).toLowerCase();
  if (statusCode === 403 && /captcha|cf-challenge|challenge|are you a robot|access denied|just a moment/.test(s)) return true;
  if (statusCode === 429 && /rate.?limit|too many|retry/.test(s)) return true;
  if (statusCode === 403) return true;
  if (statusCode === 404 && /cloudflare|verification/.test(s)) return true;
  return false;
}

// ─── Fake identity headers ───
const OS_POOL = ['Windows NT 10.0; Win64; x64', 'X11; Linux x86_64', 'Macintosh; Intel Mac OS X 10_15_7'];
const BROWSER_POOL = ['Chrome/126.0.0.0 Safari/537.36', 'Chrome/125.0.6422.141 Safari/537.36', 'Firefox/127.0', 'Safari/605.1.15 Version/17.4'];

function _rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fakeIdentityHeaders(provider) {
  const os = _rand(OS_POOL);
  const ua = 'Mozilla/5.0 (' + os + ') AppleWebKit/537.36 (KHTML, like Gecko) ' + _rand(BROWSER_POOL);
  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': _rand(['en-US,en;q=0.9', 'en-GB,en;q=0.8', 'en,en-US;q=0.9']),
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-CH-UA': '"Chromium";v="126", "Not/A)Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': _rand(['"Windows"', '"Linux"', '"macOS"']),
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
  // Provider-specific tweaks
  if (provider === 'or') {
    headers['Origin'] = 'https://openrouter.ai';
    headers['Referer'] = 'https://openrouter.ai/';
  } else if (provider === 'google' || provider === 'gemini') {
    headers['Origin'] = 'https://aistudio.google.com';
    headers['Referer'] = 'https://aistudio.google.com/';
  }
  return headers;
}

// ─── Egress selection ───
function egressFor(provider) {
  // Route provider-specific egress identity
  const map = {
    or: { via: 'tor', identity: 'or-rotate' },
    gemini: { via: 'direct', identity: 'gemini-clean' },
    default: { via: 'tor', identity: 'round-robin' }
  };
  return map[provider] || map.default;
}

// ─── Detection handling: rotate identity + Tor circuit ───
function handleDetection(provider) {
  try {
    const { execSync } = require('child_process');
    // Rotate Tor circuit
    execSync('printf "AUTHENTICATE\\r\\nSIGNAL NEWNYM\\r\\n" | nc 127.0.0.1 9051 2>/dev/null || true', { timeout: 5000, stdio: 'ignore' });
  } catch (e) {}
  // Clear any cached identity markers for this provider
  delete rotateAll._lastRotate[provider];
  return { rotated: true, provider };
}

// ─── Rotate all identities ───
rotateAll._lastRotate = {};
function rotateAll() {
  for (const k of Object.keys(rotateAll._lastRotate)) {
    if (Date.now() - rotateAll._lastRotate[k] > 3600000) delete rotateAll._lastRotate[k];
  }
  return { rotated: Object.keys(rotateAll._lastRotate).length, nextInMs: 3600000 };
}

module.exports = { isChallenge, egressFor, handleDetection, fakeIdentityHeaders, rotateAll };
