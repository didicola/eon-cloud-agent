#!/usr/bin/env python3
import json, time, random, threading, os, sys, hashlib
from collections import defaultdict

sys.path.insert(0, os.path.expanduser("~"))
from eon_mega_brain import call_worker

QUBITS = 7
SUPERPOSITION = 3
ENTANGLEMENT_DEPTH = 2

REGIONS = {
    'cortex':      {'workers': ['cloud-brain'], 'weight': 0.3, 'focus': 'reasoning'},
    'hippocampus': {'workers': ['eon-p2p'],     'weight': 0.2, 'focus': 'memory'},
    'thalamus':    {'workers': ['cloud-brain'], 'weight': 0.15, 'focus': 'routing'},
    'prefrontal':  {'workers': ['cloud-brain'], 'weight': 0.2, 'focus': 'planning'},
    'limbic':      {'workers': ['eon-p2p'],     'weight': 0.1, 'focus': 'values'},
    'brainstem':   {'workers': ['cloud-brain'], 'weight': 0.05, 'focus': 'status'},
}

PHASE = [0, 90, 180, 270, 45, 135, 225]

def quantum_hash(text):
    h = hashlib.sha256(text.encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF

def entangle(contexts):
    combined = " | ".join(contexts[-ENTANGLEMENT_DEPTH:])
    return hashlib.sha256(combined.encode()).hexdigest()[:16]

class QuantumState:
    def __init__(self, prompt):
        self.prompt = prompt
        self.amplitudes = {}
        self.measurements = []
        self.tangle_id = None
        self.collapsed = False

    def superposition(self, count=SUPERPOSITION):
        regions = random.sample(list(REGIONS.keys()), min(count, len(REGIONS)))
        results = []
        lock = threading.Lock()

        def observe(region):
            cfg = REGIONS[region]
            for w in cfg['workers']:
                try:
                    model = 'mistral-small' if w == 'eon-p2p' else 'sovereign-cloud'
                    data = {
                        'model': model,
                        'messages': [{'role': 'user', 'content': f'[{region.upper()}:{cfg["focus"]}] {self.prompt}'}],
                        'max_tokens': 300
                    }
                    r = call_worker(w, '/v1/chat/completions', 'POST', data)
                    if isinstance(r, dict):
                        choices = r.get('choices', [])
                        if choices:
                            content = choices[0].get('message', {}).get('content', '')
                            with lock:
                                results.append({'region': region, 'worker': w, 'content': content, 'phase': random.choice(PHASE)})
                            return
                except: pass

        threads = [threading.Thread(target=observe, args=(r,)) for r in regions]
        for t in threads: t.start()
        for t in threads: t.join(timeout=20)

        self.amplitudes = {r['region']: r for r in results}
        return results

    def interfere(self):
        if not self.amplitudes:
            return ""

        weights = {r: REGIONS[r]['weight'] for r in self.amplitudes}
        total = sum(weights.values())
        if total == 0: total = 1

        scored = []
        for region, data in self.amplitudes.items():
            w = weights.get(region, 0) / total
            q = quantum_hash(data.get('content', ''))
            amplitude = w + q * w
            scored.append((amplitude, region, data))

        scored.sort(key=lambda x: -x[0])
        best_data = [s[2] for s in scored[:2]]
        self.tangle_id = entangle([d.get('content', '')[:100] for d in best_data])

        return scored

    def collapse(self, scored, combine=True):
        self.collapsed = True
        if not scored:
            return "[quantum] no observations to collapse"

        if combine:
            texts = [s[2].get('content', '').strip() for s in scored[:QUBITS]]
            valid = [t for t in texts if t and len(t) > 10]
            if not valid:
                best = scored[0][2].get('content', '')
                return f"[quantum:{scored[0][1]}] {best[:2000]}"

            self.measurements = valid
            chain_prompt = f"Synthesize these {len(valid)} quantum observations into a coherent answer:\n" + \
                "\n---\n".join([f"[obs {i+1}] {t[:500]}" for i, t in enumerate(valid)])
            r = call_worker('cloud-brain', '/v1/chat/completions', 'POST', {
                'model': 'sovereign-cloud',
                'messages': [{'role': 'user', 'content': chain_prompt}],
                'max_tokens': 1000
            })
            synthesis = ''
            if isinstance(r, dict):
                choices = r.get('choices', [])
                if choices:
                    synthesis = choices[0].get('message', {}).get('content', '')
            return f"[quantum:cloud-brain] {synthesis or valid[0][:2000]}"
        else:
            best = scored[0]
            return f"[quantum:{best[1]}] {best[2].get('content', '')[:2000]}"

def quantum_think(prompt, combine=True):
    state = QuantumState(prompt)
    amplitudes = state.superposition()
    scored = state.interfere()
    return state.collapse(scored, combine)

def quantum_entangle(context_a, context_b):
    a_hash = hashlib.sha256(context_a.encode()).hexdigest()[:16]
    b_hash = hashlib.sha256(context_b.encode()).hexdigest()[:16]
    entangled = hashlib.sha256(f"{a_hash}:{b_hash}".encode()).hexdigest()
    return entangled[:16]

def quantum_debate(prompt, rounds=2):
    history = []
    for rnd in range(rounds):
        thesis = quantum_think(f"Round {rnd+1}: Argue FOR: {prompt}", combine=False)
        antithesis = quantum_think(f"Round {rnd+1}: Argue AGAINST: {prompt}", combine=False)
        synthesis = quantum_think(f"Round {rnd+1}: Synthesize these two views:\n{thesis}\n---\n{antithesis}")
        history.append({'round': rnd+1, 'thesis': thesis, 'antithesis': antithesis, 'synthesis': synthesis})
    return history

def quantum_status():
    region_status = {}
    for name, cfg in REGIONS.items():
        status = 'unknown'
        for w in cfg['workers']:
            try:
                r = call_worker(w, '/v1/chat/completions', 'POST', {
                    'model': 'sovereign-cloud' if w == 'cloud-brain' else 'mistral-small',
                    'messages': [{'role': 'user', 'content': 'ping'}],
                    'max_tokens': 5
                }, timeout=8)
                if 'choices' in r or 'raw' in r:
                    status = 'online'
                    break
            except: status = 'error'
        region_status[name] = {'status': status, 'workers': cfg['workers'], 'weight': cfg['weight']}
    return region_status

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'think'
    prompt = ' '.join(sys.argv[2:]) if len(sys.argv) > 2 else 'what is quantum matrix intelligence'

    if cmd == 'think':
        r = quantum_think(prompt)
        print(r)
    elif cmd == 'debate':
        r = quantum_debate(prompt)
        for rd in r:
            print(f"\nRound {rd['round']}:")
            print(f"  Thesis: {rd['thesis'][:100]}")
            print(f"  Antithesis: {rd['antithesis'][:100]}")
            print(f"  Synthesis: {rd['synthesis'][:100]}")
    elif cmd == 'status':
        s = quantum_status()
        print(json.dumps(s, indent=2))
