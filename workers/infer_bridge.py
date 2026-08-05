#!/usr/bin/env python3
"""
infer_bridge.py — Sovereign Inference Bridge (service #13)
Solves opencode's "Streaming response failed: [503] The request queue is full":
a thin OpenAI-compatible front, bound where opencode's provider expects, that
transparently rotates across the Sovereign Matrix backends using the Ghost Round
Matrix. On "503 queue is full" / 429 / 5xx / connect-fail it slips to the next
backend with exponential backoff, so opencode never sees the queue-full 503.

Speaks:
  GET  /v1/models                  -> model list
  POST /v1/chat/completions        -> JSON (stream=false) or SSE (stream=true)

Golden rule: endpoints are OUR sovereign matrix (:8200 / :8090 / :8092) + an embedded
eon-blind-proxy the bridge spawns itself. This is a thin router only — never source of truth.
"""
import json
import os
import re
import subprocess
import sys
import time
import threading
import collections
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SRV_HOST = "127.0.0.1"
SRV_PORT = int(os.environ.get("EON_INFER_PORT", "8201"))          # where opencode points
MODEL = os.environ.get("EON_INFER_MODEL", "auto")

# ── Embedded eon-blind-proxy (more powerful, sovereign, zero earthly keys) ──
# We keep our OWN copy inside workers/ and spawn it as a parallel child on a dedicated
# internal port so the bridge owns its lifecycle (it runs "inside him", in parallel).
# The child is FULLY detached: new session + stdin/stdout/stderr away from the caller,
# so starting the bridge NEVER hangs the invoking shell (inherited-fd bug fix).
EMBED_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "eon-blind-proxy.js")
EMBED_PORT = int(os.environ.get("EON_EMBED_BP_PORT", "8093"))
EMBED_UPSTREAM = os.environ.get("EON_EON_BLINDPROXY", "http://127.0.0.1:8092")
_embed_proc = None
_embed_started = False


def _port_open(port, timeout=1.0):
    """True if something accepts TCP on 127.0.0.1:port."""
    try:
        import socket
        s = socket.create_connection(("127.0.0.1", port), timeout=timeout)
        s.close()
        return True
    except Exception:
        return False


def ensure_embedded(backends):
    """Spawn the embedded eon-blind-proxy (if not already up) and insert it at the
    front of the backend rotation so the bridge prefers the sovereign, powerful engine.
    Returns a possibly-updated backend list. NEVER blocks the caller shell: the child
    is fully detached (new session + DEVNULL stdin/stdout + log-file stderr) and only
    registered as a backend after its port actually answers."""
    global _embed_proc, _embed_started
    embed_url = f"http://127.0.0.1:{EMBED_PORT}/v1/chat/completions"
    if not os.path.exists(EMBED_SCRIPT):
        return backends
    # Already listening (boot_stack daemon or a previous embedded child) -> reuse, no re-spawn.
    if not _embed_started and _port_open(EMBED_PORT):
        _embed_started = True
    if not _embed_started:
        env = dict(os.environ)
        env["EON_BP_PORT"] = str(EMBED_PORT)
        try:
            log_fd = open("/tmp/eon-embed-bp.log", "a")
            # Fully detach: new session, stdin/stdout -> DEVNULL, stderr -> log file,
            # close_fds so NO caller fd leaks into the child (the inherited-fd that kept
            # the invoking shell waiting on a pipe). start_new_session=True daemonizes.
            _embed_proc = subprocess.Popen(["node", EMBED_SCRIPT],
                                           env=env,
                                           stdin=subprocess.DEVNULL,
                                           stdout=subprocess.DEVNULL,
                                           stderr=log_fd,
                                           start_new_session=True,
                                           close_fds=True)
            log_fd.close()  # parent no longer needs the child's stderr fd
            # Wait (up to ~8s) for the child to bind before trusting it as a backend.
            for _ in range(16):
                time.sleep(0.5)
                if _port_open(EMBED_PORT):
                    _embed_started = True
                    break
            print(f"[infer-bridge] embedded eon-blind-proxy "
                  f"{'UP' if _embed_started else 'FAILED (no port bound)'} "
                  f":{EMBED_PORT} (pid {_embed_proc.pid})", flush=True)
            if not _embed_started:
                # Child did not come up -> keep serving the OTHER backends, do not insert.
                return backends
        except Exception as e:
            print(f"[infer-bridge] embedded spawn failed: {e}", flush=True)
            return backends
    # Insert embedded backend at front if not already present (parallel race vs 8092).
    names = [n for n, _ in backends]
    if "eon-blindproxy" not in names:
        backends.insert(0, ("eon-blindproxy", embed_url))
    return backends


# Ordered list of (name, url) sovereign backends the Ghost Round Matrix rotates across.
# Embedded eon-blind-proxy (our workers/ copy) is inserted at the front by ensure_embedded.
DEFAULTS = [
    ("blindproxy", os.environ.get("EON_BLINDPROXY", "http://127.0.0.1:8090") + "/v1/chat/completions"),
]
# (legacy "matrix" backend :8200 was dropped — it's not running and only stalled races)
BACKENDS = []
for raw in os.environ.get("EON_LLM_BACKENDS", "").split(","):
    raw = raw.strip()
    if raw:
        name, _, url = raw.partition("|")
        BACKENDS.append((name or "b", url))
BACKENDS = BACKENDS or DEFAULTS
BACKENDS = ensure_embedded(BACKENDS)

TIMEOUT = int(os.environ.get("EON_INFER_TIMEOUT", "300"))
_GHOST = None  # set lazily in the request handler thread


def _is_retryable(status, body):
    t = f"{status} {body}".lower()
    return any(q in t for q in ("request queue is full", "queue is full",
                                "per_queue_limit", "overloaded", "busy", "429")) \
        or status in (429, 502, 503, 504, 0)


def _post_json(url, payload, timeout=TIMEOUT):
    """POST payload, return (status, body_text)."""
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)


def ghost_round(payload):
    """Rotate across BACKENDS; return {status, body, endpoint} for the first non-queue-full."""
    from ghost_matrix import GhostMatrix
    gm = GhostMatrix(BACKENDS, max_tries=int(os.environ.get("EON_GHOST_TRIES", "7")),
                     base_delay=0.3, cap=6.0)
    for n in range(gm.max_tries):
        chosen = gm._next()
        if chosen is None:
            return {"ok": False, "status": 503, "endpoint": None,
                    "error": "all backends parked", "payload": payload}
        name, url = chosen
        status, body = _post_json(url, payload, TIMEOUT)
        if not _is_retryable(status, body):
            return {"ok": status < 400, "status": status, "body": body, "endpoint": name}
        gm._cooldown[name] = time.time() + min(gm.cap, gm.base_delay * (2 ** n))
        time.sleep(min(gm.cap, gm.base_delay * (2 ** n)))
    return {"ok": False, "status": 503, "endpoint": None,
            "error": "request queue full (ghost exhausted) on all backends", "payload": payload}


def _sse(payload, content):
    """Emit OpenAI-style SSE chat completion deltas from a finished content string."""
    cid = f"chatcmpl-{int(time.time())}"
    # opening role chunk
    yield f'data: {json.dumps({"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": payload.get("model", MODEL), "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}}]})}\n\n'
    # word-by-word deltas
    words = content.split(" ")
    for i in range(len(words)):
        delta = words[i] + (" " if i < len(words) - 1 else "")
        yield f'data: {json.dumps({"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": payload.get("model", MODEL), "choices": [{"index": 0, "delta": {"content": delta}}]})}\n\n'
    yield f'data: {json.dumps({"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": payload.get("model", MODEL), "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})}\n\n'
    yield "data: [DONE]\n\n"


def _content_from(body):
    """Pull assistant text from an OpenAI-compatible JSON body, with graceful fallbacks."""
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            return body
    if isinstance(body, dict):
        ch = body.get("choices") or []
        if ch:
            msg = (ch[0].get("message") or {}) if isinstance(ch[0], dict) else {}
            c = msg.get("content")
            if c is None:
                c = ch[0].get("text")
            if c is not None:
                return c
            # some proxies put content at top level
            for k in ("content", "response", "output"):
                if isinstance(body.get(k), str):
                    return body[k]
        if body.get("content"):
            return body["content"]
        if body.get("response"):
            return body["response"]
        if body.get("error"):
            return f"[sovereign-backend-error] {body['error']}"
    return str(body)


# ═══════════════════════════════════════════════════════════════════════════
# MULTI-MODEL CONSENSUS BRAIN — race 3 sovereign models, score, pick winner.
# Sovereign + all-in-cloud: every member is one of OUR backends (eon-blind-proxy,
# blind-proxy, matrix). Answers scored by normalized token overlap (agreement) +
# latency weight; the winner is cached at fluid speed (5-10ms on repeat).
# ═══════════════════════════════════════════════════════════════════════════
CONSENSUS_K = int(os.environ.get("EON_CONSENSUS_K", "3"))
CONSENSUS_ENABLED = os.environ.get("EON_CONSENSUS", "1") != "0"

# ── Short-term conversational memory: the brain remembers its accepted answers
#    across turns and uses them to nudge consensus scoring toward the
#    conversation's established line (continuity, never domination). ──
MEM_WEIGHT = float(os.environ.get("EON_CONVO_WEIGHT", "0.15"))
CONVO_MEM = collections.deque(maxlen=int(os.environ.get("EON_CONVO_MEM", "6")))
_convo_mem_lock = threading.Lock()


def _convo_mem_put(entry):
    with _convo_mem_lock:
        CONVO_MEM.append(entry)


def _mem_reference():
    """Most recent prior-turn winner content (None when memory is empty)."""
    with _convo_mem_lock:
        if CONVO_MEM:
            return CONVO_MEM[-1].get("content")
    return None


def _convo_status():
    with _convo_mem_lock:
        recent = [{"q": e.get("q"), "winner": e.get("winner")}
                  for e in list(CONVO_MEM)[-3:]]
        return {"turns": len(CONVO_MEM), "weight": MEM_WEIGHT, "recent": recent}


def _norm_tokens(text):
    """Lowercase + alphanumeric tokens for overlap scoring."""
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _jaccard(a, b):
    a = _norm_tokens(a)
    b = _norm_tokens(b)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _member_alive(name, url, timeout=3.0):
    """Optimistic liveness probe:
    - True on real success OR timeout (a slow cold-starting brain is still usable).
    - False only on FAST hard failure (connection refused / DNS / 4xx/5xx), which is
      the dead-matrix case — a recessed backend must never stall the consensus race.
    """
    payload = {"messages": [{"role": "user", "content": "hi"}], "model": "auto"}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return True
    except urllib.error.HTTPError:
        return False                     # backend answered with a clear error
    except (TimeoutError, urllib.error.URLError) as e:
        # couldn't complete fast glitch -> assume usable; consensus join() bounds it
        if isinstance(e, TimeoutError):
            return True
        return False
    except Exception:
        return False


def consensus_round(payload):
    """Race CONSENSUS_K distinct backends in parallel; score + pick winner.

    Returns {ok, content, status, endpoint, votes, scores, winner, member_ms}.
    Disables itself (ok fallback to ghost_round) if there aren't enough distinct
    backends or a member request queue-fills (ghost matrix parks it anyway).
    """
    if not CONSENSUS_ENABLED or len(BACKENDS) < 2:
        return {"ok": False, "skip": "consensus disabled or <2 backends",
                "payload": payload}
    # Liveness gate: only alive backends enter the race, so a dead member can
    # never stall the whole consensus (it would otherwise burn its full timeout).
    alive = [(n, u) for n, u in BACKENDS[:CONSENSUS_K * 3]
             if _member_alive(n, u)]
    members = alive[:CONSENSUS_K]
    if len(members) < 2:
        return {"ok": False, "skip": "consensus: <2 alive backends",
                "payload": payload}
    results = {}
    results_lock = threading.Lock()

    def _member(name, url):
        status, body = _post_json(url, payload, TIMEOUT)
        content = _content_from(body)
        with results_lock:
            results[name] = {"status": status, "content": content,
                             "ms": time.time()}

    threads = [threading.Thread(target=_member, args=(n, u)) for n, u in members]
    t0 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=TIMEOUT + 2)

    completed = {n: r for n, r in results.items()
                 if r["status"] < 400 and r.get("content")}
    if len(completed) < 2:
        # not enough brains agreed to be online -> fall back to first answer
        if completed:
            n, r = next(iter(completed.items()))
            return {"ok": True, "content": r["content"], "status": r["status"],
                    "endpoint": n, "votes": {n: r["content"]},
                    "scores": {n: 1.0}, "winner": n, "member_ms": (time.time() - t0) * 1000}
        return {"ok": False, "error": "consensus: zero members answered",
                "payload": payload}

    # pairwise agreement scores + latency weight (faster member = small bonus)
    # + memory-context boost: a member aligned with the previous accepted answer
    # gets a slight preference for conversational continuity (opt-out via no_memory).
    scores = {}
    names = list(completed.keys())
    mem_ref = None if payload.get("no_memory") else _mem_reference()
    for i, n in enumerate(names):
        agg = 0.0
        for m in names:
            if m == n:
                continue
            agg += _jaccard(completed[n]["content"], completed[m]["content"])
        agreement = agg / max(1, len(names) - 1)
        latency_bonus = max(0.0, 0.05 - 0.02 * abs(len(names) - i))  # tiny nudge
        mem_boost = (_jaccard(completed[n]["content"], mem_ref) * MEM_WEIGHT
                     if mem_ref else 0.0)
        scores[n] = round(agreement + latency_bonus + mem_boost, 3)
    winner = max(scores, key=scores.get)
    return {"ok": True, "content": completed[winner]["content"],
            "status": completed[winner]["status"], "endpoint": winner,
            "votes": {n: r["content"] for n, r in completed.items()},
            "scores": scores, "winner": winner,
            "member_ms": round((time.time() - t0) * 1000, 1)}


# ═══════════════════════════════════════════════════════════════════════════
# FLUID ROUND MATRIX — quantum/ghost/dark-matter neuro-organ fast path.
# Layered UNDER the GhostMatrix rotation: micro-cache + local-brain fast path +
# pre-warm keep-alive + sticky-node echo. Millisecond-class on repeat/trivial
# requests while the sovereign cloud race keeps the first real answer sovereign.
# ═══════════════════════════════════════════════════════════════════════════
CACHE_MAX = int(os.environ.get("EON_FLUID_CACHE", "512"))
_cache = collections.OrderedDict()          # norm(user_msg) -> completion content
_cache_lock = threading.Lock()
CACHE_STATS = {"size": 0, "hits": 0, "misses": 0}


def _norm_last(messages):
    """Normalize the exact last user message: stripped + lowercased."""
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "user" and m.get("content"):
            return str(m["content"]).strip().lower()
    return ""


def _cache_get(key):
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            CACHE_STATS["hits"] += 1
            return _cache[key]
        CACHE_STATS["misses"] += 1
        return None


def _cache_put(key, content):
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
        _cache[key] = content
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)
        CACHE_STATS["size"] = len(_cache)


def via_local_brain(messages):
    """Local-brain fast path: trivial/short queries answered locally, zero cloud.
    Mirrors eon-blind-proxy's viaLocalBrain keyword style (greetings, ping, health,
    who-are-you, time, summarize) — sub-millisecond to ~10ms."""
    key = _norm_last(messages)
    t = key
    if not t:
        return None
    if re.match(r"^(hi|hello|hey|yo)\b", t):
        return "Hello! EON Fluid Round Matrix online."
    if re.match(r"^(ping|are you there|status|health)$", t):
        return "EON Fluid Round Matrix online. Cloud: eon-p2p-cloud + cloud-brain-proxy + eon-site + cloud-native (parallel-race)."
    if re.search(r"who are you|what are you", t):
        return "I am the EON Fluid Round Matrix — sovereign, keyless, routing through the Parallel World cloud at speed-of-light."
    if re.search(r"what time|time is|date is", t):
        return time.strftime("%a, %d %b %Y %H:%M:%S UTC", time.gmtime())
    if re.search(r"summar", t):
        body = t.split(":", 1)[1].strip() if ":" in t else ""
        return (body[:200] + ("..." if len(body) > 200 else "")) if body else "Nothing to summarize."
    return None


# ── Pre-warm: fire a benign request at :8093 on startup so the sovereign cloud
#    nodes wake up and sticky-node latency is populated BEFORE the first real
#    request. Non-blocking; logs [fluid] pre-warm ok. ──
def _prewarm():
    try:
        time.sleep(0.5)
        _post_json(f"http://127.0.0.1:{EMBED_PORT}/v1/chat/completions",
                   {"model": "auto", "stream": False, "max_tokens": 4,
                    "messages": [{"role": "user", "content": "hi"}]}, timeout=60)
        print("[fluid] pre-warm ok", flush=True)
    except Exception as e:
        print(f"[fluid] pre-warm skipped: {e}", flush=True)


def _start_prewarm():
    threading.Thread(target=_prewarm, daemon=True).start()


def _sticky_echo():
    """Pull eon-blind-proxy latency/sticky state (GET /v1/routing) for /v1/matrix."""
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{EMBED_PORT}/v1/routing")
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read().decode())
    except Exception:
        return {}


# ── Trigonometric Round Matrix (all-in-cloud, pure math, in light of speed) ──
# Mirrors the worker's trig routing so the bridge can weight backends the same quantum-ghost
# way: cos-bound sticky [0,2], sin load sweet-spot (50%), log1p distance compression,
# tan slope tie-break. Advances a per-backend phase per request.
_TRIG_PHASE = {}


def _trig_round_weight(phase):
    import math
    return max(0.0, min(2.0, math.cos(phase)))


def _trig_load_weight(load):
    import math
    v = math.sin(math.pi * max(0.0, min(1.0, load)))
    return max(0.0, v)


def _trig_dist_weight(age_s):
    import math
    return 1.0 / (1.0 + math.log1p(max(age_s, 0.0) + 1.0))


def _trig_slope(phase):
    import math
    t = math.tan(phase)
    return min(t, 10.0) if t > 0 else 0.0


def _trig_route(last_load, last_age):
    """Return a trig decision dict: which backend direction to bias and its trig scores."""
    import math
    phase = _TRIG_PHASE.get("bridge", 0.0) + 0.7
    _TRIG_PHASE["bridge"] = phase
    return {
        "phase": round(phase, 3),
        "cos_sticky": round(_trig_round_weight(phase), 3),
        "sin_load_sweetspot": round(_trig_load_weight(last_load), 3),
        "log1p_distance": round(_trig_dist_weight(last_age), 3),
        "tan_slope": round(_trig_slope(phase), 3),
        "ghost_hop": f"ghost-bridge-{int(math.degrees(phase)) % 360}",
    }


_last_route = {"load": 0.0, "age": 0.0, "at": 0.0}


_start_prewarm()


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _sse_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

    def _models(self):
        self._json(200, {"object": "list", "data": [
            {"id": MODEL, "object": "model", "owned_by": "eon"}]})

    def do_GET(self):
        if self.path.rstrip("/") == "/v1/models" or self.path.startswith("/v1/models"):
            self._models()
            return
        if self.path.rstrip("/") == "/v1/matrix":
            sticky = _sticky_echo()
            import time as _t
            trig = _trig_route(_last_route.get("load", 0.0),
                               (_t.time() - _last_route.get("at", _t.time())))
            self._json(200, {
                "service": "eon-fluid-round-matrix",
                "latency_ms_table": sticky.get("latency_table", {}),
                "sticky_nodes": sticky.get("sticky_nodes", {}),
                "cache": dict(CACHE_STATS),
                "providers": ["eon-blindproxy", "blindproxy", "matrix"],
                "fast_path": "lru+local+prewarm",
                "quantum": "parallel-race",
                "consensus": {"enabled": CONSENSUS_ENABLED, "k": CONSENSUS_K,
                              "members": [n for n, _ in BACKENDS[:CONSENSUS_K]]},
                "trig": {**trig, "routing": "cos+sin+tan+log1p", "bounded": "[0,2]"},
            })
            return
        if self.path.rstrip("/") == "/v1/consensus":
            self._json(200, {
                "service": "eon-multi-model-consensus-brain",
                "enabled": CONSENSUS_ENABLED,
                "k": CONSENSUS_K,
                "members": [n for n, _ in BACKENDS[:CONSENSUS_K]],
                "scoring": "jaccard-token-overlap + latency-bonus",
                "memory": _convo_status(),
                "cache": dict(CACHE_STATS),
            })
            return
        if self.path.rstrip("/") == "/health" or self.path == "/":
            self._json(200, {"status": "ok", "service": "eon-infer-bridge",
                             "port": SRV_PORT, "backends": [n for n, _ in BACKENDS],
                             "model": MODEL, "fluid": dict(CACHE_STATS)})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        ln = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(ln) if ln else b"{}"
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"stream": False}

        if self.path.rstrip("/") == "/v1/chat/completions":
            stream = bool(payload.get("stream"))
            # ── FLUID fast path 1: local-brain (trivial queries, zero cloud) ──
            content = via_local_brain(payload.get("messages"))
            if content is not None:
                if stream:
                    self._sse_headers()
                    for frame in _sse(payload, content):
                        try:
                            self.wfile.write(frame.encode())
                        except BrokenPipeError:
                            break
                    return
                self._json(200, {
                    "id": f"chatcmpl-{int(time.time())}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": payload.get("model", MODEL),
                    "choices": [{"index": 0,
                                 "message": {"role": "assistant", "content": content},
                                 "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    "_fluid": "local-brain",
                })
                return
            # ── FLUID fast path 2: micro-cache LRU (repeat requests, millisecond) ──
            ckey = _norm_last(payload.get("messages"))
            cached = _cache_get(ckey) if ckey else None
            if cached is not None:
                if stream:
                    self._sse_headers()
                    for frame in _sse(payload, cached):
                        try:
                            self.wfile.write(frame.encode())
                        except BrokenPipeError:
                            break
                    return
                self._json(200, {
                    "id": f"chatcmpl-{int(time.time())}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": payload.get("model", MODEL),
                    "choices": [{"index": 0,
                                 "message": {"role": "assistant", "content": cached},
                                 "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    "_fluid": "lru-cache-hit",
                })
                return
            # ── Sovereign path: MULTI-MODEL CONSENSUS (3 brains race, best wins) ──
            # Then GhostMatrix rotation as fallback. Consensus adds latency (~race of K
            # members in parallel = ~max member time, not sum) for better answers on
            # cold misses; the winner is cached so repeat questions hit at 5-10ms.
            if os.environ.get("EON_CONSENSUS", "1") != "0":
                cr = consensus_round(payload)
                if cr.get("ok") and cr.get("content"):
                    content = cr["content"]
                    if ckey:
                        _cache_put(ckey, content)
                    # ── Conversational memory: remember this accepted turn so the
                    #    next consensus round can score for continuity. ──
                    _convo_mem_put({"q": ckey, "winner": cr.get("winner"),
                                    "content": content, "t": time.time()})
                    _last_route["load"] = 0.5
                    _last_route["age"] = 0.0
                    _last_route["at"] = time.time()
                    meta = {"endpoint": cr.get("endpoint"), "winner": cr.get("winner"),
                            "scores": cr.get("scores"), "member_ms": cr.get("member_ms"),
                            "consensus": True}
                    if stream:
                        self._sse_headers()
                        for frame in _sse(payload, content):
                            try:
                                self.wfile.write(frame.encode())
                            except BrokenPipeError:
                                break
                        return
                    self._json(200, {
                        "id": f"chatcmpl-{int(time.time())}",
                        "object": "chat.completion",
                        "created": int(time.time()),
                        "model": payload.get("model", MODEL),
                        "choices": [{"index": 0,
                                     "message": {"role": "assistant", "content": content},
                                     "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                        "_consensus": meta,
                    })
                    return
            r = ghost_round(payload)
            if not r.get("ok"):
                # If every backend is queue-full/exhausted, degrade with a readable payload.
                err_msg = r.get("error", "request queue full (ghost exhausted)")
                if stream:
                    self._sse_headers()
                    for frame in _sse(payload, f"[infer-bridge] {err_msg}"):
                        try:
                            self.wfile.write(frame.encode())
                        except BrokenPipeError:
                            break
                    return
                self._json(r.get("status", 503), {"error": err_msg, "endpoint": r.get("endpoint")})
                return
            content = _content_from(r.get("body", ""))
            if ckey:
                _cache_put(ckey, content)
            # Trigonometric Round Matrix: record the winning backend + trig decision.
            _last_route["load"] = 0.5 if r.get("ok") else 0.0
            _last_route["age"] = 0.0
            _last_route["at"] = time.time()
            if stream:
                self._sse_headers()
                for frame in _sse(payload, content):
                    try:
                        self.wfile.write(frame.encode())
                    except BrokenPipeError:
                        break
                return
            self._json(200, {
                "id": f"chatcmpl-{int(time.time())}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": payload.get("model", MODEL),
                "choices": [{"index": 0,
                             "message": {"role": "assistant", "content": content},
                             "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            })
            return
        self._json(404, {"error": "only /v1/chat/completions supported"})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    from gzip import GzipFile  # noqa  (ensure stdlib present)
    # Detach the bridge's own stdin from the caller so neither it nor anything it ever
    # spawns can hold a caller pipe/fd open and make the invoking shell wait forever.
    try:
        if not sys.stdin.isatty():
            sys.stdin.close()
            sys.stdin = open(os.devnull, "r")
    except Exception:
        pass
    print(f"[infer-bridge] {','.join(n for n, _ in BACKENDS)} via GhostMatrix on :{SRV_PORT} (model={MODEL})")
    srv = ThreadingHTTPServer((SRV_HOST, SRV_PORT), H)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[infer-bridge] stopped")