# HUNT SESSION 2026-10-02 - Cloud-Ubuntu Execution Lanes (EON-HUNTER)
Sanitized record - no tokens, no private keys, no LAN addresses.

## Lanes proven (task receipts)
- Delegate queue POST /delegate/to-local: ricos uid1000, sandbox-limited (signals/D-Bus/pkg-tools EPERM). Receipts: local-task-1790982057680-m14lqw + 8 more.
- /orchestrate via DEFAULT tunnel lane: root, un-jailed. Receipts: t-1790977959347-pt7x, t-1790983308950-qodn (DEFAULT_LANE_OK).
- /orchestrate via brain quick-tunnel (NEW, tunnel-INDEPENDENT, single brain bearer): t-1790983099266-u7n2, t-1790983593711-qxf4, t-1790983679458-3hbk.
- Loopback exec :8799/:8445: uid1000, token-or-loopback after security fix; used for ops receipts.

## Incident - default tunnel down 22:54:42Z -> restored 23:18:22Z
- Prod tunnel-client process alive but wedged (State S, NRestarts=0, no reconnect after close).
- Delegate lane cannot repair: kill -> Permission denied (LSM); systemctl -> D-Bus blocked.
- Fix via quick-lane root: systemctl restart eon-tunnel-client -> new PID 787025 -> cloud status active connectedAt=1790983102904 (verified x4).
- Side-finding: earlier delegate kill STILL-ALIVE was a false negative - target was already a zombie (Zs); ps -p succeeds on corpses; root kill KIRC=0.

## Load
- Back-to-back distill #3 (identical 99-trace set, worker at ep1 step 20/95) terminated via root lane; load 1-min avg 39 -> 6.9.

## Security (co-owner session, verified 12/12)
- :8445 and :8799 authless-exec holes closed (token-or-loopback). Loopback arm retained for local automation.

## liboqs / ICNN
- eon-venv python3.14 liboqs-python native lib loads: enabled KEM BIKE-L1/L3/L5, Classic-McEliece-*; SIG ML-DSA-44/65/87, Falcon-512.
- ICNN units restarted 23:28:03Z (MainPID 814130, root, both active). Post-restart health probe: HTTP=000 fast-fail -> DIAGNOSIS PENDING.

## Executor findings (orchestrate DO)
- Submit timeout is enforced as a kill; on kill the result is NOT written -> task record stuck status=running forever (t-1790983735946-9t2b). Queue unaffected (subsequent tasks complete instantly).
- 12 pre-existing stale ubuntu gate tasks (D2885-D2887 family): no consumer for target=ubuntu.

## Open watch items
- agi_loop distill cooldown bug: distill_last_end never persisted (in-memory state saves clobber external writes); stale .distill.lock from 22:47Z -> stale-reclaim likely fires DISTILL #4 on same data ~23:49Z. Fix = set distill_last_end in worker finally-block (co-owner owns file).
- ICNN :9443 post-restart HTTP=000: next = listener check + journalctl -u eon-icnn-https with bounded timeout.
- Render edge: gated by RENDER-ACCEPTANCE-20260919.md - owner deploy-click only, no agent creds on box; status recorded, no action taken.

## Boards carrying this record
- mother.md append (hunt block, 5475 lines at write time)
- gdrive: eon-sync/2026-10-02/ (this file via rclone)
- github: docs/HUNT-2026-10-02-cloud-ubuntu-lanes.md (this file, sanitized identical)
- openhuman memory: namespace hunt
