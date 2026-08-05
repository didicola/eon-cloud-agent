#!/usr/bin/env python3
"""
ghost_matrix.py — EON Ghost Round Matrix
Defeats transient "503 The request queue is full" (or 429) from inference/compute
backends by rotating across a list of sovereign endpoints with exponential backoff.

Design (golden-rule compliant: no earthly deps; endpoints are ours):
  - given an ordered list of (name, url) backends, try them round-robin;
  - on 503-quota-full / 429 / connect-error -> rotate to the next endpoint,
    with exponential backoff (base ** n), capped;
  - on 2xx/4xx-non-retryable -> return immediately;
  - track per-route "ghost" reputation so a repeatedly-full route is parked
    (cool-down) instead of hammered.
"""
import asyncio
import json
import random
import time

QUEUE_FULL = ("request queue is full", "queue is full", "per_queue_limit",
              "the request queue is full", "429", "1027", "overloaded", "busy")


def _is_retryable(status_code: int, body: str, status_text: str = "") -> bool:
    t = " ".join([str(status_code), status_text, body or ""]).lower()
    return any(q in t for q in QUEUE_FULL) or status_code in (429, 502, 503, 504, 0)


class GhostMatrix:
    """Round-robin queue-full retry across sovereign endpoints."""

    def __init__(self, backends, max_tries=8, base_delay=0.4, cap=8.0, stop_epochs=0):
        self.backends = list(backends)          # list of (name, base_url) or callables
        self.max_tries = max_tries
        self.base_delay = base_delay
        self.cap = cap
        self.idx = random.randrange(len(backends)) if backends else 0
        self._cooldown = {}                     # name -> unlock timestamp
        self.attempts = 0
        self.hits = 0

    def _next(self):
        if not self.backends:
            return None
        for _ in range(len(self.backends)):
            self.idx = (self.idx + 1) % len(self.backends)
            name = self.backends[self.idx][0] if isinstance(self.backends[self.idx], tuple) else self.backends[self.idx]
            if self._cooldown.get(name, 0) <= time.time():
                return self.backends[self.idx]
        # all parked -> pick the one with the earliest cooldown
        self.idx = min(range(len(self.backends)),
                       key=lambda i: self._cooldown.get(self._name(self.backends[i]), 0))
        return self.backends[self.idx]

    def _name(self, b):
        return b[0] if isinstance(b, tuple) else str(b)

    async def call(self, do_call, mk_args):
        """do_call(endpoint) -> (status:int, body:str). mk_args maybe unused hook.

        Iterate backends, calling do_call with the chosen endpoint tuple.
        Yields the first non-retryable result, else keeps rotating.
        """
        stalled = 0
        for n in range(self.max_tries):
            self.attempts += 1
            chosen = self._next()
            if chosen is None:
                return {"ok": False, "status": 503, "error": "all endpoints parked"}
            status, body = await do_call(chosen)
            if status is None:
                status = 0
            if not _is_retryable(status, body):
                self.hits += 1
                return {"ok": status < 400, "status": status, "body": body, "endpoint": self._name(chosen)}
            name = self._name(chosen)
            self._cooldown[name] = time.time() + min(self.cap, self.base_delay * (2 ** n))
            delay = min(self.cap, self.base_delay * (2 ** n))
            await asyncio.sleep(delay)
        return {"ok": False, "status": 503, "error": "request queue full (ghost exhausted) on all backends"}


# A synchronous convenience core for simple backends (no async framework needed).
def run_round(endpoints, do_call, max_tries=5, base=0.3, cap=4.0):
    gm = GhostMatrix(endpoints, max_tries=max_tries, base_delay=base, cap=cap)
    result = {"ok": False, "status": 503, "error": "ghost exhausted"}
    for _ in range(max_tries):
        # temporarily emulate via synchronous loop for simple scripts
        for ep in endpoints:
            name = ep[0] if isinstance(ep, tuple) else str(ep)
            if gm._cooldown.get(name, 0) > time.time():
                continue
            status, body = do_call(ep)
            if not _is_retryable(status, body):
                gm.hits += 1
                result = {"ok": status < 400, "status": status, "body": body, "endpoint": name}
                return result
            gm._cooldown[name] = time.time() + base
        time.sleep(base)
    return result


# ---- Ghost matrix scoring/reputation record -------------------------------------------------
_MEM = {}


def ghost_score(name, ok=True):
    ts = time.time()
    k = _MEM.get(name, {"ok": 0, "fail": 0, "last": 0})
    if ok:
        k["ok"] += 1
    else:
        k["fail"] += 1
    k["last"] = ts
    _MEM[name] = k
    return k


# Provide a JSON summary for a dashboard/status endpoint ---------------------------------------
def ghost_state():
    return {"backends": [b[0] if isinstance(b, tuple) else str(b) for b in _mtrx_backends],
            "attempts": _attempts,
            "hits": _hits,
            "reputation": _MEM}


# small in-module backends registry used by `ghost_state`
_mtrx_backends = []
_attempts = 0
_hits = 0


def join(backends):
    """install an initial backend set (idempotent)."""
    if not _mtrx_backends:
        _mtrx_backends[:] = backends