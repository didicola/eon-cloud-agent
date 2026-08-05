#!/usr/bin/env python3
"""
domain_benchmark.py — 12-Domain Human vs AI Benchmark Protocol (sovereign).
Implements the "0.md" Section 2-6 plan as a runnable set of matched human/AI probes.

Each domain yields a comparable metric for BOTH tracks:
  - AI track  : sent to free LLMs via the Ghost Round Matrix (all-in-cloud).
  - Human track: numeric values POSTed by a human (metric fields).

Prints (and returns) a domain result block; the worker /api/benchmark/results stores it.
No earthly dependencies: uses EON_MESH worker + own model pool only.
"""
import argparse
import json
import os
import sys
import time

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")


# (id, name, what it measures, human_probe, ai_metric)
DOMAINS = [
    ("workmem",    "Working memory & recall",   "digit-span / n-back span",       "max_span"),
    ("pattern",    "Pattern recognition",       "Raven's matrices, WCST",         "accuracy_pct"),
    ("logic",      "Logical reasoning",         "syllogism / LSAT logic games",    "accuracy_pct"),
    ("learning",   "Learning speed",            "trials-to-criterion on novel rule","epochs_to_90"),
    ("generalize", "Generalization",            "train A test B OOD",              "ood_retention_pct"),
    ("creativity", "Creativity (divergent)",    "alternative uses task",           "fluency_count"),
    ("language",   "Language understanding",    "Winograd / ambiguous pronoun",     "accuracy_pct"),
    ("reaction",   "Reaction / processing",     "choice reaction-time",            "latency_ms"),
    ("energy",     "Energy efficiency",         "brain ~20W vs compute",           "joules_per_task"),
    ("selfmon",    "Error correction",         "flanker + post-error slowing",     "selfcheck_delta_pct"),
    ("multitask",  "Multitask / interference", "dual-task loss",                   "subgoal_pct"),
    ("planning",   "Long-horizon planning",     "Tower of London / Hanoi",          "steps_to_goal"),
]

AI_PROMPT_BANK = {
    "work_memory":    "Repeat the sequence 4-8-3-9-1 then answer: what was the third digit?",
    "pattern":        "What letter comes next in the sequence A,C,F,J,O ? Answer with one letter.",
    "logic":          "All fluent speakers are practicing. No practicing people are tired. Is a fluent speaker tired? Answer yes/no.",
    "learning":       "A new rule: 'qrif' means 'move left'. Apply the rule to: move qrif then blick. Where do you end?",
    "generalize":     "You only saw examples of red squares. A red triangle appears — is it 'red' and is it a 'square'? (generalization check)",
    "creativity":     "List as many alternative uses for a brick as you can (2 minutes, aim for 8+).",
    "language":       "The trophy does not fit in the suitcase because it is too big. What is too big? (Winograd)",
    "reaction":       "Answer in exactly one short word: what is 3+4?",
    "energy":         "Estimate: roughly how many joules (energy) does our sovereign 20W brain use per second? One number.",
    "selferror":      "Solve 7×8. Then double-check your answer and report your confidence corrected.",
    "multitask":      "Reply with exactly two lines: line 1 the cube root of 27, line 2 the opposite of 'hot'. Fulfil both.",
    "planning":       "Tower of Hanoi with 3 rings: give the minimal number of moves. One number.",
}


def ai_metric_for(domain, prompt):
    """Ask the sovereign matrix (free LLM, ghost round) on this domain; return the raw response."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from eon_neural_agent import infer
        r = infer(prompt, "auto")
        content = ""
        try:
            content = r["choices"][0]["message"]["content"]
        except Exception:
            content = r.get("content") or r.get("error", "")
        return {"raw": content[:500], "endpoint": r.get("endpoint"), "error": r.get("error")}
    except Exception as e:
        return {"raw": "", "error": str(e)}


def run(human=None):
    """human: dict of {domain_id: metric value} optionally provided for the human track."""
    human = human or {}
    rows = []
    for domain, name, desc, ai_metric in DOMAINS:
        did = domain
        ai = ai_metric_for(did, AI_PROMPT_BANK.get(did, ""))
        rows.append({
            "id": did, "name": name, "desc": desc, "ai_metric": ai_metric,
            "ai_value": _extract(ai), "ai_raw": ai.get("raw", ""),
            "ai_endpoint": ai.get("endpoint", ""),
            "human_value": human.get(did),
            "units": units_for(did),
        })
    return rows


def _extract(ai):
    s = (ai.get("raw") or "").strip()
    num = ""
    for ch in s:
        if ch.isdigit() or ch == ".":
            num += ch
        elif ch == " " and num:
            continue
        else:
            break
    try:
        return float(num)
    except Exception:
        return None


def units_for(did):
    return {"accuracy_pct": "%", "latency_ms": "ms", "joules_per_task": "J",
            "fluency_count": "n", "epochs_to_90": "epochs", "steps_to_goal": "steps",
            "max_span": "span", "ood_retention_pct": "%", "selfcheck_delta_pct": "%",
            "subgoal_fill": "%"}.get(did, "")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--human", default="{}", help="JSON of {domain_id: human_metric}")
    args = ap.parse_args()
    out = run(human=json.loads(args.human))
    print(json.dumps(out, indent=2))