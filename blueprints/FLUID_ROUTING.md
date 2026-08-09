# EON Dark Matter Routing — Ground-Truth Blueprint (1B)

Status: `eon-cloud-worker/fluid_router.js` implements this TODAY (verified by
source read, 2026-08-09). The proposal's routing priority is already the
implementation.

## Priority (per request, millisecond shifts, never polled)
```
1. edge      — native Cloudflare fetch (trusted, fast, clean)
2. warp      — WARP SOCKS via .eon tunnel -> Matrix Processor :8200 /fluid?layer=warp
3. chameleon — Chameleon Engine pool via the same fluid gateway
4. tor       — last-resort anonymous routing via the same fluid gateway
```
- `ROUTE_ORDER = ['edge','warp','chameleon','tor']`
- Retry triggers: `RETRY_CODES = {429, 500, 502, 503, 504}` + network errors.
- Every layer is OPTIONAL: if none configured, the edge IS the routing layer.

## How the fluid layers execute
The Worker cannot open SOCKS sockets directly, so WARP/Chameleon/Tor are
executed by the Matrix Processor (local process, holds the Fluid Identity
Cover) reached over the .eon tunnel (`EON_MESH_URL`):
`POST <tunnel>/api/remote/fluid?layer=<name>` with `{url, method, headers, body}`.

## Actual state on this box (2026-08-09)
- Matrix Processor listening `127.0.0.1:8200` (python) — the fluid gateway.
- Own-cloud runtime listening `127.0.0.1:8787` (python).
- Cloudflare edge deploy: BLOCKED (no valid credential) — edge layer currently
  resolves to the on-device runtime; Tor direct egress works as the fallback
  (this session's GitHub lane runs over Tor).
- When a CF credential exists, `wrangler deploy` puts the worker on the real
  edge and the full priority chain activates.

## Verify commands (proposal)
- `grep -q 'fluid_router|edge.*warp.*chameleon.*tor' shadow-mesh.js` — PASS
  (module exists; the chain is in fluid_router.js, imported by the worker).
