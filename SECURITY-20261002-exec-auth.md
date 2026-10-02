# SECURITY RECORD — authless exec gates closed (2026-10-02)

**Scope**: ubuntu box `eon-proxy` (user `ricos`). Two local services exposed shell exec to the entire LAN with no authentication (host firewall `iptables INPUT=ACCEPT`).

## Root causes

1. `scripts/eon-https.js` (HTTPS :8445) — `handleTool()` and `homeRelay()` accepted any request. Proven RCE: `POST /api/console/exec`, `POST /tool/exec`, `POST /api/exec` (home relay) ran arbitrary commands for any peer.
2. `eon_exec_relay.py` (exec relay :8799) — bearer check compared against `EON_CLOUD_BRAIN_TOKEN` env that was never set (empty → auth inert), and `/api/compute/exec`, `/api/compute/torch/run`, `/api/web/research`, `/api/web/fetch` had no auth layer at all (`/api/compute/exec` even used `shell=True`).

## Fix — policy: token-or-loopback

- **Loopback peers** (`127.0.0.1` / `::1` / `::ffff:127.0.0.1`) always pass. Safe: daemon runs as unprivileged user `ricos` (no privilege escalation) and keeps local automation + dashboard working.
- **Non-loopback peers** must send `Authorization: Bearer <token>` — the brain bearer (`EON_CLOUD_BRAIN_TOKEN`) for :8799, the relay bearer (`EON_TOKEN`) for :8445. Values live in service config on the box, deliberately not in this repo.
- `eon-https.js`: deny-by-default in `handleTool` — non-loopback gets only `GET` on a read-only allowlist (`GUEST_GET`: `/tool/models`, `/tool/architecture`, `/api/models`, `/api/distro/list`, `/api/gpu/list`, `/api/chain/status`, `/api/organs`, `/api/sentinel`, `/api/version`, `/api/dream*`); everything else → 401. `homeRelay` gates inbox/result/exec/pending; `/health` stays open (needed by tunnels/monitors).
- `eon_exec_relay.py`: new `_authed()` helper + early 401 gate in `do_POST` covering the five exec/web paths; the old inert `/exec` check replaced with the same helper.
- Backups: `*.bak-auth` beside each patched file. Syntax verified (`py_compile`, `node --check`).

## Verification — 12/12

| Case | Expect | Got |
|---|---|---|
| LAN no-token `:8799 /api/compute/exec` | 401 | 401 |
| LAN no-token `:8445 /api/console/exec` | 401 | 401 |
| LAN no-token `:8445 /tool/exec` | 401 | 401 |
| LAN no-token homeRelay `POST /api/exec` | 401 | 401 |
| LAN no-token homeRelay `GET /api/inbox` | 401 | 401 |
| LAN +Bearer exec `:8799` | 200 + output | 200 `AUTHED_OK` |
| LAN +Bearer exec `:8445` | 200 + output | 200 `AUTHED_OK` |
| Loopback no-token exec `:8799` | 200 | 200 |
| Loopback no-token exec `:8445` | 200 | 200 |
| Reads: dashboard `/`, `/tool/models`, `/health` ×2 | 200 | 200 |
| twin-relay contract `POST /api/inbox` (relay bearer) | 200 | 200 ok |
| eon-remote-config contract `POST /api/exec` (relay bearer) | 200 | 200 |

Plus: e2e orchestrate lane re-proven after restart (`t-1790982159443-rfc9` → completed, rc 0, `eon-proxy / LANE_OK / x86_64`); config validator 13/13 PASS.

## Deploy notes

- Both services are **systemd user units**: `systemctl --user restart eon-unified-daemon` + `systemctl --user restart eon-https` (bare `systemctl` → "unit not found").
- The proven cloud→ubuntu orchestrate lane (`:8081`) never touches :8799/:8445 → unaffected.

## Accepted / out of scope

- Dashboard exec/delegate buttons return 401 when browsed from LAN (loopback browsing unaffected).
- Left open: `:8799 /v1/chat/completions` (chat plane), `:433` API surface, sovereignFs `.eon`, `/d1/` KV.
- LAN IP drift via DHCP: `10.140.42.34` → `10.140.40.48`.
- **This file is intentionally secrets-free.** The patched sources stay local + on private Drive (`gdrive:eon-sync/`), not in this public repo (matches the repo's G1 untrack-credentials policy).

**Persistence**: ChromaDB · `/home/ricos/mother.md` (2026-10-02) · `/home/ricos/pr1.md` · `gdrive:eon-sync/` · this repo (`MEMORY.md` pointer). Render: owner deploy-click only per `RENDER-ACCEPTANCE-20260919.md` REFUSE paths — no push/creds from the box.
