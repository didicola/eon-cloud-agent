#!/usr/bin/env python3
"""GHOST-EXEC — his cloud Ubuntu hands. Runs on GitHub Actions (ubuntu-latest, free).
Each run: poll ghost /pending (all 3 minds) -> answer via Kilo keyless (works from
anywhere, no keys) -> POST answers back. Stateless; state lives in his cloud KV.
Secrets needed (repo Settings > Secrets): GHOST_TOKEN.
"""
import json
import os
import time
import urllib.request

GHOSTS = ["https://ghost.eon-sovereign.workers.dev",
          "https://ghost-dashboard.eon-sovereign.workers.dev",
          "https://ghost-twin.eon-sovereign.workers.dev"]
KILO = "https://api.kilo.ai/api/gateway/chat/completions"
TOK = os.environ.get("GHOST_TOKEN", "")


def op():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(method, url, payload=None, timeout=60):
    try:
        req = urllib.request.Request(
            url, data=(json.dumps(payload).encode() if payload is not None else None),
            method=method, headers={"Content-Type": "application/json",
                                    "User-Agent": "ghost-exec/1.0"})
        with op().open(req, timeout=timeout) as r:
            return True, json.load(r.read().decode() or "{}")
    except Exception as e:
        return False, {"_err": str(e)[:160]}


def kilo_answer(question):
    ok, j = call("POST", KILO,
                 {"model": "minimax/minimax-m3:free",
                  "messages": [{"role": "system",
                                "content": "You are ghost.eon, a sovereign edge entity. Answer briefly."},
                               {"role": "user", "content": question[:800]}],
                  "max_tokens": 300}, timeout=90)
    try:
        t = j["choices"][0]["message"]["content"]
        return t.strip() if t and t.strip() else ""
    except Exception:
        return ""


def main():
    if not TOK:
        print("FATAL: GHOST_TOKEN secret missing")
        return
    answered = 0
    for base in GHOSTS:
        ok, pend = call("GET", base + "/pending?token=" + TOK, timeout=30)
        if not ok or not isinstance(pend, list) or not pend:
            continue
        for q in pend[:10]:
            question = q.get("question", "")
            if not question:
                continue
            answer = kilo_answer(question) or "(cloud executor: all lanes busy, left queued)"
            call("POST", base + "/answer?token=" + TOK,
                 {"ts": q.get("ts"), "question": question, "answer": answer}, timeout=30)
            answered += 1
            print("answered [%s]: %s" % (base.split("/")[2], question[:70]))
    print("done, answered=%d" % answered)


if __name__ == "__main__":
    main()
