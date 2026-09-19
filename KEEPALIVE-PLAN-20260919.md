# KEEP-ALIVE PLAN — STAGED (lawful own-service, no sleep-circumvention engine)
Free services sleep after 15 min idle; wake on request (cold start). Policy:

## ALLOWED (genuine use)
- The standing watch loops already read service health on their normal cadence (rotation/solution passes). Those reads are REAL checks with receipts, and incidentally keep the service warm while EON is actively watched. No extra traffic exists for its own sake.

## FORBIDDEN
- No dedicated sub-minute pinger, no synthetic traffic whose only purpose is defeating sleep. Evading free-tier limits as a goal = circumventing the provider's terms = force-adjacent. Refused.

## HONEST CONSEQUENCES
- Idle service WILL sleep; first request after sleep is slow (cold start). Loops must tolerate this: retry-gate + longer timeout on first probe after silence, record cold-start as normal event, never as failure.
- If 24/7 wakefulness becomes a NEED (not a want), the lawful answers are: paid tier (owner seed) or a host without sleep (box seed) — both staged, neither forced.

## WATCH ITEM
- If Render flags the health reads as abuse, stand DOWN immediately to longer cadence + report to owner. Provider rules outrank our convenience.
