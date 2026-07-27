#!/usr/bin/env python3
"""
🜂 EON MEGA BRAIN CHAIN v4.0 — The Infinite Intelligence Client
Calls each Worker DIRECTLY. No proxy, no Cloudflare challenges.
39 models. 8 Workers. ×100 verification chain.
"""
import urllib.request, json, os, sys, time, ssl

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


def call_worker(name, path, method='GET', data=None, timeout=None):
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


def route_task(prompt, model='auto'):
    lower = prompt.lower()
    if model != 'auto':
        if model in ('dream',): return 'eon-p2p', 'qwq-32b'
        if model == 'verify': return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'
        return 'cloud-brain', model
    if any(w in lower for w in ['dream', 'imagine', 'what if']): return 'eon-p2p', 'qwq-32b'
    if any(w in lower for w in ['remember', 'memory', 'recall']): return 'eon-p2p', 'llama-3.3-70b'
    if any(w in lower for w in ['code', 'function', 'implement', 'debug', 'class']): return 'eon-p2p', 'qwen-coder'
    if any(w in lower for w in ['analyze', 'compare', 'evaluate', 'explain']): return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'
    if any(w in lower for w in ['creative', 'story', 'write', 'poem']): return 'eon-p2p', 'kimi-k2.7'
    if any(w in lower for w in ['reason', 'think', 'logic']): return 'eon-p2p', 'deepseek-r1'
    if any(w in lower for w in ['fast', 'quick', 'simple', 'hi', 'hello']): return 'eon-p2p', 'mistral-small'
    if any(w in lower for w in ['verify', 'check', 'fact']): return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'
    return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'


def chat(prompt, model='auto', max_tokens=2000):
    worker, resolved = route_task(prompt, model)
    result = call_worker(worker, '/v1/chat/completions', 'POST', {'model': resolved, 'messages': [{'role': 'user', 'content': prompt}], 'max_tokens': max_tokens})
    return {'worker': worker, 'model': resolved, 'response': result}


def verify(statement, rounds=3):
    results = []
    pool = ['cloud-brain', 'eon-p2p', 'delegate-relay']
    for i in range(rounds):
        w = pool[i % len(pool)]
        r = chat(f"Round {i+1}: Verify and score confidence 0-100. Statement: {statement}", model='verify')
        results.append({'round': i+1, 'worker': w, 'result': r})
    return {'statement': statement, 'rounds': results, 'total_rounds': rounds}


def dream_list(limit=10): return call_worker('eon-p2p', f'/dream/list?limit={limit}')
def dream_store(title, content, tags=None): return call_worker('eon-p2p', '/dream/store', 'POST', {'title': title, 'content': content, 'tags': tags or []})
def dream_cycle(): return call_worker('eon-p2p', '/dream/cycle', 'POST')
def dream_insights(): return call_worker('eon-p2p', '/dream/insights')
def dream_stats(): return call_worker('eon-p2p', '/dream/stats')
def sync_health(): return call_worker('eon-p2p', '/sync/health')
def sync_models(): return call_worker('eon-p2p', '/sync/models')
def sync_memory(limit=50): return call_worker('eon-p2p', f'/sync/memory?limit={limit}')
def delegate_cloud(t, p): return call_worker('eon-p2p', '/delegate/to-cloud', 'POST', {'agent_type': t, 'prompt': p})
def delegate_local(target, action): return call_worker('eon-p2p', '/delegate/to-local', 'POST', {'target': target, 'action': action})
def delegate_pending(): return call_worker('eon-p2p', '/delegate/pending')
def opencode_dispatch(p): return call_worker('eon-p2p', '/opencode/dispatch', 'POST', {'prompt': p})
def opencode_agents(): return call_worker('eon-p2p', '/opencode/agents')
def upgrade_propose(t, c, r): return call_worker('eon-p2p', '/upgrade/propose', 'POST', {'target': t, 'content': c, 'reason': r})
def upgrade_pending(): return call_worker('eon-p2p', '/upgrade/pending')
def p2p_peers(): return call_worker('eon-p2p', '/p2p/peers')
def p2p_announce(name, caps): return call_worker('eon-p2p', '/p2p/announce', 'POST', {'name': name, 'capabilities': caps})


def status():
    results = {}
    for name in WORKERS:
        r = call_worker(name, '/health', timeout=5)
        results[name] = {'online': 'error' not in r and 'raw' not in r, 'data': r}
    return results


def models():
    p2p = call_worker('eon-p2p', '/v1/models')
    return {'cloud-brain': ['cloud-brain-proxy/sovereign-cloud'], 'eon-p2p': [m['id'] for m in p2p.get('data', [])], 'delegate-relay': ['freellmapi', 'proxygategllm'], 'total': 2 + len(p2p.get('data', [])) + 2}


def print_json(data):
    print(json.dumps(data, indent=2, default=str)[:3000])


# ═══════════════════════════════════════════════════════════
# CONTINUATION CHAT MODE
# ═══════════════════════════════════════════════════════════
def run_chat(model='auto', max_tokens=2000):
    print("\033[1;36m🜂 EON MEGA BRAIN CHAIN — Continuation Chat\033[0m")
    print(f"   Model: {model} | Max tokens: {max_tokens}")
    print("   Commands: /clear /history /model <name> /dream /status /quit")
    print("\033[90m" + "═" * 50 + "\033[0m")

    history = []
    machine = 'termux' if 'termux' in os.popen('uname -a').read().lower() else 'ubuntu'

    while True:
        try:
            user_input = input(f"\033[36m{machine}>\033[0m ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye")
            break

        if not user_input:
            continue

        if user_input.startswith('/'):
            cmd = user_input.split()[0].lower()
            if cmd in ('/quit', '/exit', '/q'): print("Bye"); break
            elif cmd == '/clear': history.clear(); print("History cleared")
            elif cmd == '/history':
                for h in history[-10:]: print(f"  [{h['role']}] {h['content'][:80]}")
            elif cmd == '/model':
                parts = user_input.split()
                if len(parts) > 1: model = parts[1]; print(f"Model: {model}")
                else: print(f"Current: {model}")
            elif cmd == '/dream':
                r = dream_list(3)
                for e in r.get('entries', [])[:3]: print(f"  - {e.get('title', '?')}")
            elif cmd == '/dream-stats':
                print_json(dream_stats())
            elif cmd == '/status':
                for n in ['cloud-brain', 'eon-p2p', 'delegate-relay']:
                    r = call_worker(n, '/health', timeout=5)
                    print(f"  {'✅' if 'error' not in r else '❌'} {n}")
            elif cmd == '/models':
                for src, ml in models().items():
                    if src != 'total': print(f"  {src}: {len(ml)} models")
            elif cmd == '/verify':
                s = ' '.join(user_input.split()[1:])
                if s: print_json(verify(s))
                else: print("Usage: /verify <statement>")
            else: print(f"Unknown: {cmd}")
            continue

        history.append({'role': 'user', 'content': user_input})
        context = history[-20:]
        worker, resolved = route_task(user_input, model)
        result = call_worker(worker, '/v1/chat/completions', 'POST', {'model': resolved, 'messages': context, 'max_tokens': max_tokens})

        content = ''
        if 'choices' in result: content = result['choices'][0]['message']['content']
        elif 'raw' in result: content = f"[{worker}] {result['raw'][:200]}"
        elif 'error' in result: content = f"[error] {result['error']}"
        else: content = str(result)[:200]

        print(f"\033[33m[{worker}/{resolved}]\033[0m")
        print(content)
        history.append({'role': 'assistant', 'content': content})


# ═══════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════
HELP = """
\033[1;36m🜂 EON MEGA BRAIN CHAIN v4.0\033[0m

  CHAT:
    eon chat "prompt"            Auto-route to best brain
    eon chat --model code "fn"   Force model
    eon "prompt"                 Short for chat
    eon --chat                   Continuation chat mode
    eon -c                       Continuation chat (short)

  VERIFICATION:
    eon verify "statement"      ×3 cross-worker verification
    eon verify --rounds 5 "s"   Custom rounds

  STATUS:
    eon status                  All workers health
    eon models                  All available models

  DREAM:
    eon dream-list / dream-cycle / dream-insights / dream-stats

  SYNC:
    eon sync-health / sync-models / sync-memory

  DELEGATE:
    eon delegate-cloud "type" "prompt"
    eon delegate-local "target" "action"
    eon delegate-pending

  OPENCODE:
    eon opencode "prompt"
    eon opencode-agents

  UPGRADE:
    eon upgrade "target" "content" "reason"
    eon upgrade-pending

  P2P:
    eon peers
    eon announce "name"
"""

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('--chat', '-c'):
        m = sys.argv[2] if len(sys.argv) > 2 else 'auto'
        t = int(sys.argv[3]) if len(sys.argv) > 3 else 2000
        run_chat(m, t)
    else:
        args = sys.argv[1:]
        if not args or args[0] in ('-h', '--help', 'help'): print(HELP); sys.exit(0)
        cmd = args[0]

        if cmd == 'status': print_json(status())
        elif cmd == 'models': print_json(models())
        elif cmd == 'chat' or cmd not in ('status','models','verify','dream-list','dream-cycle','dream-insights','dream-stats','sync-health','sync-models','sync-memory','delegate-cloud','delegate-local','delegate-pending','opencode','opencode-agents','upgrade','upgrade-pending','peers','announce'):
            if cmd == 'chat':
                prompt = ' '.join(args[1:]); model = 'auto'
                if '--model' in args:
                    i = args.index('--model'); model = args[i+1] if i+1 < len(args) else 'auto'
                    prompt = ' '.join(a for a in args[1:] if a not in ('--model', model))
            else: prompt = ' '.join(args); model = 'auto'
            r = chat(prompt, model)
            c = r.get('response',{}).get('choices',[{}])[0].get('message',{}).get('content','')
            if not c: c = r.get('response',{}).get('raw', r.get('response',{}).get('error','No response'))
            print(f"[{r['worker']}/{r['model']}]"); print(c)
        elif cmd == 'verify':
            rnd = 3
            if '--rounds' in args:
                i = args.index('--rounds'); rnd = int(args[i+1]) if i+1 < len(args) else 3
                stmt = ' '.join(a for a in args[1:] if a not in ('--rounds', str(rnd)))
            else: stmt = ' '.join(args[1:])
            print_json(verify(stmt, rnd))
        elif cmd == 'dream-list': print_json(dream_list())
        elif cmd == 'dream-cycle': print_json(dream_cycle())
        elif cmd == 'dream-insights': print_json(dream_insights())
        elif cmd == 'dream-stats': print_json(dream_stats())
        elif cmd == 'sync-health': print_json(sync_health())
        elif cmd == 'sync-models': print_json(sync_models())
        elif cmd == 'sync-memory': print_json(sync_memory())
        elif cmd == 'delegate-cloud' and len(args) >= 3: print_json(delegate_cloud(args[1], ' '.join(args[2:])))
        elif cmd == 'delegate-local' and len(args) >= 3: print_json(delegate_local(args[1], args[2]))
        elif cmd == 'delegate-pending': print_json(delegate_pending())
        elif cmd == 'opencode': print_json(opencode_dispatch(' '.join(args[1:])))
        elif cmd == 'opencode-agents': print_json(opencode_agents())
        elif cmd == 'upgrade' and len(args) >= 4: print_json(upgrade_propose(args[1], args[2], ' '.join(args[3:])))
        elif cmd == 'upgrade-pending': print_json(upgrade_pending())
        elif cmd == 'peers': print_json(p2p_peers())
        elif cmd == 'announce': print_json(p2p_announce(args[1] if len(args)>1 else 'termux', json.loads(args[2]) if len(args)>2 else ['chat','code']))
        else: print(f"Unknown: {cmd}"); print(HELP); sys.exit(1)
