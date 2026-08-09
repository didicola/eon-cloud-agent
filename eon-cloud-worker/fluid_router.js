// ═══════════════════════════════════════════════════════════════════════
// EON FLUID ROUTER — Dark Matter Routing Layer
//
// The Cloud's PRIMARY identity IS the Cloudflare Edge (its own "ISP"). It
// only needs WARP / Chameleon / Tor when an earthly API rate-limits it.
// Priority per REQUEST (millisecond shifts, never polled):
//   1. edge     — native Cloudflare fetch (trusted, fast, clean)
//   2. warp     — WARP SOCKS (via .eon tunnel -> Matrix Processor fluid layer)
//   3. chameleon— Chameleon Engine pool (via .eon tunnel)
//   4. tor      — last-resort anonymous routing (via .eon tunnel)
// The routing shifts on real-time response codes (429/5xx/network error).
//
// The Worker cannot open SOCKS sockets directly, so WARP/Chameleon/Tor are
// executed by the Matrix Processor (which holds the Fluid Identity Cover) and
// reached over the .eon tunnel. Every layer is OPTIONAL: if none are
// configured, the edge IS the routing layer.
// ═══════════════════════════════════════════════════════════════════════

export const ROUTE_ORDER = ['edge', 'warp', 'chameleon', 'tor'];

const RETRY_CODES = new Set([429, 500, 502, 503, 504]);

function gatewayFor(env, layer) {
  // The .eon tunnel to the local fluid egress (Matrix Processor :8200 exposes
  // /fluid?layer=<name> which tunnels through that SOCKS layer).
  const base = env.EON_MESH_URL || 'https://839301ae2a61a843f7bfb701f677195e.x.uplink.spot/';
  const overrides = env.EON_FLUID_GATEWAYS; // JSON {"warp":"...","chameleon":"...","tor":"..."}
  try {
    const o = overrides ? JSON.parse(overrides) : {};
    if (o && o[layer]) return o[layer];
  } catch {}
  if (layer === 'edge') return null;
  return base + 'api/remote/fluid?layer=' + layer;
}

async function viaGateway(gateway, url, opts) {
  const body = JSON.stringify({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body || null });
  const r = await fetch(gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: opts.signal,
  });
  const txt = await r.text();
  return { status: r.status, ok: r.ok, text: txt };
}

export async function fluidFetch(url, opts = {}, env = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 20000);
  const merged = { ...opts, signal: ctl.signal };

  let lastErr = null;
  for (const layer of ROUTE_ORDER) {
    try {
      const gateway = gatewayFor(env, layer);
      let resp;
      if (!gateway) {
        resp = await fetch(url, merged);
        const text = await resp.text();
        resp = { status: resp.status, ok: resp.ok, text };
      } else {
        resp = await viaGateway(gateway, url, merged);
      }
      if (resp.ok || !RETRY_CODES.has(resp.status)) {
        clearTimeout(t);
        return { status: resp.status, ok: resp.ok, text: resp.text, layer };
      }
      lastErr = `HTTP ${resp.status} on ${layer}`;
    } catch (e) {
      lastErr = `${layer}: ${e.message}`;
    }
  }
  clearTimeout(t);
  return { status: 0, ok: false, text: '', layer: 'none', error: lastErr };
}

export async function fluidJson(url, opts = {}, env = {}) {
  const r = await fluidFetch(url, opts, env);
  try {
    return { ...r, json: r.text ? JSON.parse(r.text) : null };
  } catch {
    return r;
  }
}
