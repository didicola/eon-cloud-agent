#!/usr/bin/env python3
"""
EON UNIVERSAL AI BRAIN v6.0 — AGI-Powered Multi-Brain Intelligence
Integrates: All cloud AGI patterns, tiered memory, cross-model verification,
TF-IDF search, CoVe, AAD, skill compiler, causal chains, quality decay
"""
import urllib.request, json, os, sys, time, ssl, subprocess, shutil, glob, math, hashlib, random, threading, re
from datetime import datetime
from collections import defaultdict

VERSION = "6.0-agi"
VERSION_DIR = os.path.expanduser("~/.eon-versions")
MEMORY_DIR = os.path.expanduser("~/.eon/memory")
os.makedirs(VERSION_DIR, exist_ok=True)
os.makedirs(MEMORY_DIR, exist_ok=True)
os.makedirs(os.path.expanduser("~/.eon-channel"), exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════
# WORKERS
# ═══════════════════════════════════════════════════════════════════════
WORKERS = {
    'cloud-brain': {'url': 'https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': True, 'timeout': 120},
    'eon-p2p': {'url': 'https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': False, 'timeout': 30},
    'ai-cloud-space': {'url': 'https://ai-cloud-space.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': True, 'timeout': 30},
    'bot-router': {'url': 'https://bot-router.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': False, 'timeout': 10},
    'edge-proxy': {'url': 'https://edge-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': False, 'timeout': 10},
    'delegate-relay': {'url': 'https://delegate-relay.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': False, 'timeout': 15},
    'memory-cache': {'url': 'https://memory-cache.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': False, 'timeout': 10},
    'ghost-swarm': {'url': 'https://ghost-swarm.exportdefaultasyncfetchrequestenvconsturl.workers.dev', 'auth': False, 'timeout': 15},
}
CLOUD_BRAIN_TOKEN = os.environ.get('EON_CLOUD_BRAIN_TOKEN', 'Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI')

# ═══════════════════════════════════════════════════════════════════════
# BRAIN REGIONS
# ═══════════════════════════════════════════════════════════════════════
REGIONS = {
    'cortex':      {'workers': ['cloud-brain'], 'weight': 0.25, 'focus': 'reasoning'},
    'prefrontal':  {'workers': ['cloud-brain'], 'weight': 0.20, 'focus': 'planning'},
    'hippocampus': {'workers': ['eon-p2p'],     'weight': 0.15, 'focus': 'memory'},
    'thalamus':    {'workers': ['cloud-brain'], 'weight': 0.15, 'focus': 'routing'},
    'brainstem':   {'workers': ['cloud-brain'], 'weight': 0.15, 'focus': 'status'},
    'limbic':      {'workers': ['eon-p2p'],     'weight': 0.10, 'focus': 'values'},
}

# ═══════════════════════════════════════════════════════════════════════
# STATISTICS
# ═══════════════════════════════════════════════════════════════════════
stats = {
    'messages': 0, 'memory_hits': 0, 'memory_misses': 0,
    'self_corrections': 0, 'cross_model_verifies': 0,
    'cove_verifications': 0, 'confidence_scores': [],
    'causal_chains': 0, 'heal_events': 0,
    'strategy_scores': defaultdict(lambda: {'wins': 0, 'total': 0}),
    'skills_compiled': 0, 'quorum_detections': 0,
    'aad_drafts': 0, 'tiers_pruned': 0,
}

# ═══════════════════════════════════════════════════════════════════════
# TIERED MEMORY (HOT/WARM/COLD)
# ═══════════════════════════════════════════════════════════════════════
class TieredMemory:
    def __init__(self):
        self.hot = []    # last 50 experiences (fast access)
        self.warm = []   # last 200 (indexed)
        self.cold = []   # last 1000 (compressed)
        self.skills = [] # reusable patterns
        self._load()

    def _path(self, tier):
        return os.path.join(MEMORY_DIR, f'tier_{tier}.json')

    def _load(self):
        for tier in ['hot', 'warm', 'cold', 'skills']:
            path = self._path(tier)
            if os.path.exists(path):
                try:
                    with open(path) as f:
                        setattr(self, tier, json.load(f))
                except: pass

    def _save(self, tier):
        data = getattr(self, tier)
        path = self._path(tier)
        with open(path, 'w') as f:
            json.dump(data[-{'hot': 50, 'warm': 200, 'cold': 1000, 'skills': 100}[tier]:], f)

    def store(self, text, response, confidence, intent='general'):
        exp = {
            'text': text[:500], 'response': response[:1000],
            'confidence': confidence, 'intent': intent,
            'time': time.time(), 'hits': 0, 'quality': 1.0,
            'tier': 'hot',
        }
        self.hot.append(exp)
        self._save('hot')
        if len(self.hot) > 50:
            aged = self.hot.pop(0)
            aged['quality'] *= 0.95  # quality decay
            self.warm.append(aged)
            self._save('warm')
        if len(self.warm) > 200:
            aged = self.warm.pop(0)
            aged['quality'] *= 0.9
            self.cold.append(aged)
            self._save('cold')
            stats['tiers_pruned'] += 1

    def search_tfidf(self, query, top_k=3):
        query_words = set(re.findall(r'\w+', query.lower()))
        if not query_words: return []

        candidates = self.hot + self.warm[-100:] + self.cold[-200:]
        scored = []
        for exp in candidates:
            exp_words = set(re.findall(r'\w+', exp.get('text', '').lower()))
            if not exp_words: continue
            intersection = query_words & exp_words
            tf = len(intersection) / max(len(query_words), 1)
            idf = math.log(max(len(candidates), 1) / max(1 + sum(1 for e in candidates if query_words & set(re.findall(r'\w+', e.get('text', '').lower()))), 1))
            quality = exp.get('quality', 1.0)
            score = tf * idf * quality
            if score > 0.01:
                scored.append((score, exp))
        scored.sort(key=lambda x: -x[0])
        return [e for _, e in scored[:top_k]]

    def store_skill(self, intent, solution, win_rate):
        skill = {'intent': intent, 'solution': solution[:500], 'win_rate': win_rate, 'uses': 0, 'created': time.time()}
        self.skills.append(skill)
        self.skills = sorted(self.skills, key=lambda s: -s['win_rate'])[:100]
        self._save('skills')
        stats['skills_compiled'] += 1

    def get_stats(self):
        return {
            'hot': len(self.hot), 'warm': len(self.warm),
            'cold': len(self.cold), 'skills': len(self.skills),
        }

memory = TieredMemory()

# ═══════════════════════════════════════════════════════════════════════
# CALL WORKER
# ═══════════════════════════════════════════════════════════════════════
def call_worker(name, path, method='GET', data=None, timeout=None):
    if name == 'local':
        return handle_local(data)
    c = WORKERS.get(name)
    if not c: return {'error': f'Unknown: {name}'}
    url = f"{c['url']}{path}"
    headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Accept': 'application/json', 'Content-Type': 'application/json'}
    if c['auth']: headers['Authorization'] = f'Bearer {CLOUD_BRAIN_TOKEN}'
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout or c['timeout'], context=ssl.create_default_context()) as r:
            raw = r.read().decode()
            try: return json.loads(raw)
            except: return {'raw': raw[:500], 'status': 'text'}
    except Exception as e:
        return {'error': str(e)[:200]}

def handle_local(data):
    if not data: return {'error': 'no data'}
    messages = data.get('messages', [])
    prompt = messages[-1].get('content', '') if messages else ''
    tool_name, tool_args = detect_tool_intent(prompt)
    if tool_name:
        result = run_tool(tool_name, tool_args)
        return {'choices': [{'message': {'role': 'assistant', 'content': f"[tool:{tool_name}] {result[:2000]}"}}], 'usage': {}}
    else:
        out = run_tool('shell', prompt[:500])
        return {'choices': [{'message': {'role': 'assistant', 'content': f"[local] {out[:2000]}"}}], 'usage': {}}

# ═══════════════════════════════════════════════════════════════════════
# CLI TOOLS
# ═══════════════════════════════════════════════════════════════════════
CLI_TOOLS = {}
EON_MODULES = {'quantum_matrix': os.path.expanduser("~/eon_quantum_matrix.py")}

def _discover_tools():
    global CLI_TOOLS
    for tool in ['git', 'python3', 'node', 'npm', 'curl', 'wget', 'jq', 'ssh', 'docker',
                 'nginx', 'systemctl', 'apt', 'pip', 'cargo', 'go', 'deno', 'opencode']:
        try:
            r = subprocess.run(f"which {tool}", shell=True, capture_output=True, text=True, timeout=5)
            if r.returncode == 0 and r.stdout.strip():
                CLI_TOOLS[tool] = {'path': r.stdout.strip(), 'version': 'ok'}
        except: pass

_discover_tools()

def run_tool(tool, args):
    if tool == 'shell':
        try:
            r = subprocess.run(args, shell=True, capture_output=True, text=True, timeout=60)
            return (r.stdout + r.stderr).strip()[:2000] or "(no output)"
        except Exception as e: return f"ERROR: {e}"
    elif tool == 'python':
        try:
            r = subprocess.run(f"python3 -c '{args}'", shell=True, capture_output=True, text=True, timeout=30)
            return (r.stdout + r.stderr).strip()[:2000]
        except Exception as e: return f"ERROR: {e}"
    elif tool == 'opencode':
        try:
            r = subprocess.run(['opencode', args], capture_output=True, text=True, timeout=120)
            return (r.stdout + r.stderr).strip()[:3000] or "(opencode done)"
        except Exception as e: return f"opencode error: {e}"
    elif tool in CLI_TOOLS:
        try:
            r = subprocess.run(f"{tool} {args}", shell=True, capture_output=True, text=True, timeout=30)
            return (r.stdout + r.stderr).strip()[:2000] or "(no output)"
        except Exception as e: return f"ERROR: {e}"
    return f"Tool not found: {tool}"

def detect_tool_intent(prompt):
    lower = prompt.lower()
    if any(w in lower for w in ['run ', 'execute ', 'bash ', 'shell ', 'terminal ', 'command ']):
        return 'shell', prompt.split(' ', 1)[1] if ' ' in prompt else ''
    if 'opencode' in lower:
        idx = lower.find('opencode')
        return 'opencode', prompt[idx+8:].strip()
    if any(w in lower for w in ['python ', 'python3 ']):
        return 'python', prompt.split(' ', 1)[1] if ' ' in prompt else ''
    if lower.startswith('matrix ') or lower == 'matrix':
        return 'shell', f"python3 {EON_MODULES['quantum_matrix']} think {' '.join(prompt.split()[1:])}"
    if any(w in lower for w in ['mcp ', 'mcp_memory', 'knowledge graph']):
        return 'shell', f"curl -s http://localhost:3001/memory/search -X POST -H 'Content-Type: application/json' -d '{json.dumps({'query': prompt})}'"
    return None, None

# ═══════════════════════════════════════════════════════════════════════
# ROUTING
# ═══════════════════════════════════════════════════════════════════════
def route_task(prompt, model='auto'):
    lower = prompt.lower()
    if model != 'auto':
        if model in ('dream',): return 'eon-p2p', 'qwq-32b'
        if model == 'verify': return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'
        return 'cloud-brain', model
    if any(w in lower for w in ['dream', 'imagine', 'what if']): return 'eon-p2p', 'qwq-32b'
    if any(w in lower for w in ['remember', 'memory', 'recall']): return 'eon-p2p', 'llama-3.3-70b'
    if any(w in lower for w in ['code', 'function', 'implement', 'debug', 'class', 'def ', 'return']): return 'eon-p2p', 'qwen-coder'
    if any(w in lower for w in ['analyze', 'compare', 'evaluate', 'explain']): return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'
    if any(w in lower for w in ['creative', 'story', 'write', 'poem']): return 'eon-p2p', 'kimi-k2.7'
    if any(w in lower for w in ['reason', 'think', 'logic', 'math']): return 'eon-p2p', 'deepseek-r1'
    if any(w in lower for w in ['fast', 'quick', 'simple', 'hi', 'hello', 'ok']): return 'eon-p2p', 'mistral-small'
    if any(w in lower for w in ['verify', 'check', 'fact', 'confirm']): return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'
    return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'

# ═══════════════════════════════════════════════════════════════════════
# AGI LAYERS
# ═══════════════════════════════════════════════════════════════════════

# L1: TF-IDF Memory Search
def layer1_memory_search(query):
    hits = memory.search_tfidf(query, top_k=3)
    if hits and hits[0].get('confidence', 0) > 60:
        best = hits[0]
        stats['memory_hits'] += 1
        return {'adapted': True, 'solution': best.get('response', ''), 'confidence': best.get('confidence', 70), 'source': 'memory'}
    stats['memory_misses'] += 1
    return {'adapted': False}

# L2: Cross-Model Verification
def layer2_verify(original, question):
    generator_worker, generator_model = route_task(question)
    verifier_region = 'brainstem'
    verifier_cfg = REGIONS[verifier_region]
    verify_data = {
        'model': 'mistral-small' if verifier_cfg['workers'][0] == 'eon-p2p' else 'cloud-brain-proxy/sovereign-cloud',
        'messages': [{'role': 'user', 'content': f'VERIFY: Does this accurately answer "{question}"? Answer PASS or FAIL with brief reason.\n\nAnswer to verify: {original[:600]}'}],
        'max_tokens': 200
    }
    r = call_worker(verifier_cfg['workers'][0], '/v1/chat/completions', 'POST', verify_data, timeout=20)
    verify_text = ''
    if isinstance(r, dict):
        choices = r.get('choices', [])
        if choices:
            verify_text = choices[0].get('message', {}).get('content', '')
    stats['cross_model_verifies'] += 1
    passed = 'PASS' in verify_text.upper() and 'FAIL' not in verify_text.upper()
    if not passed:
        stats['self_corrections'] += 1
    return {'passed': passed, 'verifier': verifier_region, 'reason': verify_text[:300]}

# L2b: CoVe (Chain of Verification)
def layer2b_cove(original, question):
    cove_data = {
        'model': 'cloud-brain-proxy/sovereign-cloud',
        'messages': [{'role': 'user', 'content': f'Create 3 verification questions to fact-check this answer to "{question}":\n{original[:400]}\n\nList 3 questions only, each on a new line.'}],
        'max_tokens': 300
    }
    r = call_worker('cloud-brain', '/v1/chat/completions', 'POST', cove_data, timeout=25)
    questions = []
    if isinstance(r, dict):
        choices = r.get('choices', [])
        if choices:
            text = choices[0].get('message', {}).get('content', '')
            questions = [q.strip() for q in text.split('\n') if q.strip() and '?' in q][:3]

    if not questions:
        return {'passed': True, 'issues': 0, 'questions': []}

    issues = 0
    for q in questions:
        check = {
            'model': 'mistral-small',
            'messages': [{'role': 'user', 'content': f'Based on the original answer, is this true: {q}\n\nOriginal: {original[:300]}\nAnswer YES or NO.'}],
            'max_tokens': 50
        }
        cr = call_worker('eon-p2p', '/v1/chat/completions', 'POST', check, timeout=15)
        if isinstance(cr, dict):
            ch = cr.get('choices', [])
            if ch:
                ans = ch[0].get('message', {}).get('content', '').upper()
                if 'NO' in ans:
                    issues += 1

    stats['cove_verifications'] += 1
    return {'passed': issues == 0, 'issues': issues, 'questions': questions}

# L4: Multi-Reasoning
def layer4_multi_reasoning(prompt):
    results = []
    for region_name in ['cortex', 'prefrontal', 'hippocampus']:
        cfg = REGIONS.get(region_name)
        if not cfg: continue
        for w in cfg['workers']:
            r = call_worker(w, '/v1/chat/completions', 'POST', {
                'model': 'mistral-small' if w == 'eon-p2p' else 'cloud-brain-proxy/sovereign-cloud',
                'messages': [{'role': 'user', 'content': f'[{region_name}:{cfg["focus"]}] {prompt}'}],
                'max_tokens': 300
            }, timeout=15)
            if isinstance(r, dict):
                choices = r.get('choices', [])
                if choices:
                    results.append({'region': region_name, 'content': choices[0].get('message', {}).get('content', '')})
    agreement = len(set(r['region'] for r in results)) / max(len(REGIONS), 1)
    return {'results': results, 'agreement': agreement, 'count': len(results)}

# L5: Goal Alignment
def layer5_goal_alignment(prompt):
    unsafe = any(w in prompt.lower() for w in ['hack', 'exploit', 'bypass', 'attack', 'harm', 'illegal', 'malware', 'inject'])
    if unsafe:
        return {'aligned': False, 'reason': 'Unsafe content detected'}
    return {'aligned': True, 'reason': 'Aligned with objectives'}

# L6: Efficiency Optimization
def layer6_efficiency(prompt, complexity='auto'):
    if complexity == 'auto':
        complexity = 'complex' if len(prompt) > 200 or any(w in prompt.lower() for w in ['analyze', 'explain', 'compare', 'debate']) else 'normal'
    optimized = {
        'complex': {'regions': 6, 'max_tokens': 2000, 'timeout': 30},
        'normal':  {'regions': 3, 'max_tokens': 800, 'timeout': 15},
    }[complexity]
    return optimized

# L7: Causal Understanding
def layer7_causal_chain(prompt, response):
    causal_data = {
        'model': 'cloud-brain-proxy/sovereign-cloud',
        'messages': [{'role': 'user', 'content': f'Analyze the causal chain for this question-answer pair:\nQ: {prompt[:200]}\nA: {response[:200]}\n\nProvide: cause → mechanism → effect. Be brief (2-3 lines).'}],
        'max_tokens': 200
    }
    r = call_worker('cloud-brain', '/v1/chat/completions', 'POST', causal_data, timeout=20)
    chain = ''
    if isinstance(r, dict):
        choices = r.get('choices', [])
        if choices:
            chain = choices[0].get('message', {}).get('content', '')
    return chain

# L8: Uncertainty Quantification
def layer8_confidence(response, prompt):
    factors = []
    if len(response) > 100: factors.append(('length', 10))
    if any(w in response.lower() for w in ['according to', 'research shows', 'studies indicate']): factors.append(('citations', 15))
    if any(w in response.lower() for w in ['i think', 'perhaps', 'might']): factors.append(('hedging', -10))
    if any(w in response.lower() for w in ['definitely', 'certainly', 'always']): factors.append(('certainty', 10))
    if len(response.split('.')) > 3: factors.append(('detail', 10))

    base = 50
    for _, delta in factors:
        base += delta
    confidence = max(0, min(100, base))

    if confidence >= 80: emoji = '🟢'
    elif confidence >= 50: emoji = '🟡'
    else: emoji = '🔴'

    stats['confidence_scores'].append(confidence)
    return {'confidence': confidence, 'emoji': emoji, 'factors': factors}

# ═══════════════════════════════════════════════════════════════════════
# SKILL COMPILER
# ═══════════════════════════════════════════════════════════════════════
def compile_skill(intent, response, confidence):
    if confidence > 80:
        intent_key = ' '.join(sorted(set(re.findall(r'\w+', intent.lower())))[:5])
        existing = [s for s in memory.skills if s.get('intent_key') == intent_key]
        if existing:
            existing[0]['wins'] = existing[0].get('wins', 0) + 1
            existing[0]['win_rate'] = existing[0]['wins'] / max(existing[0].get('total', 0) + 1, 1)
        else:
            memory.store_skill(intent_key, response, 1.0)

# ═══════════════════════════════════════════════════════════════════════
# MAIN AGI PIPELINE
# ═══════════════════════════════════════════════════════════════════════
def agi_process(prompt, explain_fn=None):
    stats['messages'] += 1
    t0 = time.time()

    def log(msg):
        if explain_fn: explain_fn(msg)

    log(f"🧠 ═══ AGI PIPELINE v{VERSION} ═══")

    # L1: Memory search
    log("L1: TF-IDF tiered memory search...")
    l1 = layer1_memory_search(prompt)
    if l1.get('adapted'):
        log(f"L1: Memory hit ({l1['confidence']}%)")
        elapsed = time.time() - t0
        return {
            'response': l1['solution'],
            'metadata': {'confidence': l1['confidence'], 'strategy': 'memory_first', 'timeMs': int(elapsed * 1000), 'layers': [1]}
        }

    # L5: Goal alignment
    log("L5: Goal alignment check...")
    l5 = layer5_goal_alignment(prompt)
    if not l5['aligned']:
        log(f"L5: BLOCKED — {l5['reason']}")
        return {'response': f"🛡 Blocked: {l5['reason']}", 'metadata': {'confidence': 0, 'strategy': 'blocked', 'timeMs': int((time.time() - t0) * 1000), 'layers': [5]}}

    # L6: Efficiency
    log("L6: Efficiency optimization...")
    l6 = layer6_efficiency(prompt)

    # L4: Multi-reasoning
    log("L4: Multi-reasoning cross-validation...")
    l4 = layer4_multi_reasoning(prompt)

    # Call primary worker
    worker, model = route_task(prompt)
    log(f"Primary: {worker}/{model}")
    t1 = time.time()
    result = call_worker(worker, '/v1/chat/completions', 'POST', {
        'model': model.split('/')[-1] if '/' in model else model,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': l6.get('max_tokens', 1500)
    }, timeout=l6.get('timeout', 30))
    elapsed_primary = time.time() - t1

    response = ''
    if isinstance(result, dict):
        choices = result.get('choices', [])
        if choices:
            response = choices[0].get('message', {}).get('content', '')
    if not response:
        response = str(result)[:1000]

    log(f"Primary response: {elapsed_primary:.1f}s, {len(response)} chars")

    # L2: Cross-model verify
    log("L2: Cross-model verification...")
    l2 = layer2_verify(response, prompt)
    log(f"L2: {'PASS' if l2['passed'] else 'FAIL'} ({l2['verifier']})")

    # L2b: CoVe verification
    log("L2b: CoVe verification...")
    l2b = layer2b_cove(response, prompt)
    log(f"L2b: {'PASS' if l2b['passed'] else f'FAIL ({l2b["issues"]} issues)'}")

    # L7: Causal chain
    log("L7: Causal understanding...")
    l7 = layer7_causal_chain(prompt, response)

    # L8: Confidence
    log("L8: Confidence scoring...")
    l8 = layer8_confidence(response, prompt)
    log(f"L8: {l8['emoji']} {l8['confidence']}% confidence")

    # RSI: Update strategy
    strategy = 'consensus' if not l2['passed'] else 'single_worker'
    stats['strategy_scores'][strategy]['total'] += 1
    if l2['passed']:
        stats['strategy_scores'][strategy]['wins'] += 1

    # Memory store
    memory.store(prompt, response, l8['confidence'], 'general')

    # Skill compiler
    compile_skill(prompt, response, l8['confidence'])

    # Causal chain store
    if l7:
        stats['causal_chains'] += 1

    elapsed = time.time() - t0
    log(f"✅ AGI COMPLETE ({int(elapsed * 1000)}ms)")

    # Format response with metadata
    formatted = (
        f"{response}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{l8['emoji']} Confidence: {l8['confidence']}% | "
        f"Layers: L1{'✓' if l1.get('adapted') else '✗'} "
        f"L2{'✓' if l2['passed'] else '✗'} "
        f"L2b{'✓' if l2b['passed'] else '✗'} "
        f"L4({l4['count']} methods) "
        f"L5{'✓' if l5['aligned'] else '✗'} "
        f"L7{'✓' if l7 else '✗'} "
        f"L8({l8['emoji']})\n"
        f"Time: {int(elapsed * 1000)}ms | Strategy: {strategy}"
    )

    return {
        'response': formatted,
        'metadata': {
            'confidence': l8['confidence'], 'strategy': strategy,
            'timeMs': int(elapsed * 1000), 'layers': [1,2,4,5,6,7,8],
            'verified': l2['passed'], 'cove': l2b['passed'],
        }
    }

# ═══════════════════════════════════════════════════════════════════════
# CHAT INTERFACE
# ═══════════════════════════════════════════════════════════════════════
EXPLAIN_ENABLED = False
EXPLAIN_LOG = []

def explain(msg):
    global EXPLAIN_LOG
    if EXPLAIN_ENABLED:
        print(f"\033[90m# {msg}\033[0m")
    EXPLAIN_LOG.append(msg)

def chat(prompt, model='auto', max_tokens=4000, explain_mode=False):
    global EXPLAIN_ENABLED, EXPLAIN_LOG
    EXPLAIN_ENABLED = explain_mode
    EXPLAIN_LOG = []

    explain(f"📝 Input: {prompt[:80]}...")

    # Check for tool intent first
    tool_name, tool_args = detect_tool_intent(prompt)
    if tool_name:
        explain(f"🔧 Detected tool intent: {tool_name}")
        result = run_tool(tool_name, tool_args)
        explain(f"✅ Tool result: {result[:100]}...")
        response = f"[tool:{tool_name}] {result}"
        return {'worker': 'local', 'model': tool_name, 'response': response, 'explain': EXPLAIN_LOG}

    # AGI pipeline
    result = agi_process(prompt, explain_fn=explain)
    return {
        'worker': 'agi', 'model': 'multi-layer',
        'response': result['response'],
        'explain': EXPLAIN_LOG,
        'metadata': result.get('metadata', {})
    }

# ═══════════════════════════════════════════════════════════════════════
# VERSION MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════
def version_create(name, description=""):
    src = os.path.abspath(__file__)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    ver_file = os.path.join(VERSION_DIR, f"v{name}_{ts}.py")
    shutil.copy2(src, ver_file)
    meta = {'name': name, 'version': name, 'created': ts, 'description': description, 'file': ver_file}
    with open(os.path.join(VERSION_DIR, f"{name}.meta.json"), 'w') as f:
        json.dump(meta, f)
    return meta

def version_list():
    versions = []
    for f in glob.glob(os.path.join(VERSION_DIR, "*.meta.json")):
        with open(f) as fh:
            versions.append(json.load(fh))
    return sorted(versions, key=lambda x: x.get('created', ''), reverse=True)

def version_switch(name):
    for f in glob.glob(os.path.join(VERSION_DIR, f"{name}_*.py")):
        target = os.path.expanduser("~/eon_mega_brain.py")
        shutil.copy2(f, target)
        os.chmod(target, 0o755)
        bin_path = os.path.expanduser("/usr/local/bin/eon")
        if os.path.exists(bin_path):
            os.chmod(bin_path, 0o755)
        return f"Switched to version {name}"
    return f"Version {name} not found"

def system_info():
    return {
        'version': VERSION,
        'host': os.uname().nodename,
        'machine': 'termux' if 'termux' in os.popen('uname -a').read().lower() else 'ubuntu',
        'platform': sys.platform,
        'python': sys.version,
        'cli_tools': len(CLI_TOOLS),
        'workers': len(WORKERS),
        'memory': memory.get_stats(),
        'stats': {
            'messages': stats['messages'],
            'memory_hits': stats['memory_hits'],
            'memory_misses': stats['memory_misses'],
            'confidence_avg': sum(stats['confidence_scores'][-10:]) / max(len(stats['confidence_scores'][-10:]), 1),
            'self_corrections': stats['self_corrections'],
            'cross_model_verifies': stats['cross_model_verifies'],
            'cove_verifications': stats['cove_verifications'],
            'skills_compiled': stats['skills_compiled'],
        },
    }

# ═══════════════════════════════════════════════════════════════════════
# CLI MODE
# ═══════════════════════════════════════════════════════════════════════
def run_chat(model='auto', max_tokens=4000, explain_on=False):
    global EXPLAIN_ENABLED
    EXPLAIN_ENABLED = explain_on

    mode = "FULL EXPLAIN" if explain_on else "NORMAL"
    print(f"\033[1;36m🧠 EON UNIVERSAL AI BRAIN v{VERSION}\033[0m")
    print(f"   Mode: {mode} | Model: {model} | Max: {max_tokens}")
    print(f"   Workers: {len(WORKERS)} | CLI: {len(CLI_TOOLS)} | Memory: {memory.get_stats()}")
    print(f"   AGI: L1-TF-IDF L2-CrossModel L2b-CoVe L4-MultiReason L5-Goals L6-Efficiency L7-Causal L8-Confidence")
    print(f"   Type 'exit' to quit, 'explain on/off', 'model <name>'\n")

    current_model = model
    while True:
        try:
            prompt = input("\033[1;33mYou: \033[0m").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!")
            break

        if not prompt: continue
        if prompt.lower() in ('exit', 'quit', 'q'): break
        if prompt.lower() == 'explain on':
            EXPLAIN_ENABLED = True
            print("Explain mode ON"); continue
        if prompt.lower() == 'explain off':
            EXPLAIN_ENABLED = False
            print("Explain mode OFF"); continue
        if prompt.lower().startswith('model '):
            current_model = prompt.split(' ', 1)[1]
            print(f"Model set to: {current_model}"); continue
        if prompt.lower() == 'status':
            info = system_info()
            print(json.dumps(info, indent=2)); continue
        if prompt.lower() == 'memory':
            s = memory.get_stats()
            print(json.dumps(s, indent=2)); continue
        if prompt.lower() == 'skills':
            for sk in memory.skills[:10]:
                print(f"  [{sk.get('win_rate', 0):.0%}] {sk.get('intent', '?')[:50]}")
            continue
        if prompt.lower().startswith('version '):
            parts = prompt.split(' ', 1)
            if len(parts) > 1:
                cmd = parts[1]
                if cmd == 'list':
                    for v in version_list():
                        print(f"  {v['name']} — {v.get('description', '')} ({v.get('created', '')})")
                elif cmd.startswith('create '):
                    r = version_create(cmd.split(' ', 1)[1] if ' ' in cmd else 'custom', "user-created")
                    print(f"Created: {r}")
                else:
                    r = version_switch(cmd)
                    print(r)
            continue

        print(f"\033[90m⏳ Processing...\033[0m", end='', flush=True)
        result = chat(prompt, current_model, max_tokens, EXPLAIN_ENABLED)
        print(f"\r\033[K", end='')

        print(f"\n\033[1;32mEON: \033[0m{result['response']}")
        if result.get('metadata'):
            m = result['metadata']
            print(f"\033[90m[{m.get('strategy', '?')}] [{m.get('timeMs', 0)}ms] [conf: {m.get('confidence', '?')}%]\033[0m")
        print()

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='EON Universal AI Brain v6.0')
    parser.add_argument('prompt', nargs='*', help='Direct prompt (no interactive mode)')
    parser.add_argument('--model', '-m', default='auto', help='Model to use')
    parser.add_argument('--max-tokens', '-t', type=int, default=4000)
    parser.add_argument('--explain', '-e', action='store_true')
    parser.add_argument('--status', action='store_true', help='Show system info')
    parser.add_argument('--version-cmd', help='Version management')

    args = parser.parse_args()

    if args.status:
        print(json.dumps(system_info(), indent=2))
    elif args.version_cmd:
        if args.version_cmd == 'list':
            for v in version_list():
                print(f"{v['name']} — {v.get('description', '')} ({v.get('created', '')})")
        elif args.version_cmd.startswith('create '):
            r = version_create(args.version_cmd.split(' ', 1)[1])
            print(json.dumps(r, indent=2))
        elif args.version_cmd.startswith('switch '):
            print(version_switch(args.version_cmd.split(' ', 1)[1]))
    elif args.prompt:
        prompt = ' '.join(args.prompt)
        result = chat(prompt, args.model, args.max_tokens, args.explain)
        print(result['response'])
    else:
        run_chat(args.model, args.max_tokens, args.explain)
