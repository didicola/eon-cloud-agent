#!/usr/bin/env python3
"""
EON UNIVERSAL AI BRAIN v5.0 — The Most Powerful AI in the World
Integrates: 39 models, 8 workers, opencode, MCP memory, all CLIs, EON modules
Full explain mode, tool orchestration, self-versioning, ×1000 replication
"""
import urllib.request, json, os, sys, time, ssl, subprocess, shutil, glob
from datetime import datetime

VERSION = "5.0-universal"
VERSION_DIR = os.path.expanduser("~/.eon-versions")
os.makedirs(VERSION_DIR, exist_ok=True)
os.makedirs(os.path.expanduser("~/.eon-channel"), exist_ok=True)

# ─── Workers ──────────────────────────────────────────────────
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

# ─── Call Worker ──────────────────────────────────────────────
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

# ─── CLI Tools Auto-Discovery (lazy, not at module level) ────
_KNOWN_CLIS = ['python3','node','git','curl','jq','pip3','ssh','docker','sqlite3']  # safe --version
_KNOWN_HANG = ['opencode','npm','npx','deno','bun','go','rustc','cargo','ffmpeg','tmux','rsync','nmap','socat','nc']  # hangs or no --version

def discover_tools():
    tools = {}
    for cmd in _KNOWN_CLIS:
        path = shutil.which(cmd)
        if path:
            try:
                r = subprocess.run([cmd, '--version'], capture_output=True, text=True, timeout=2)
                ver = r.stdout.split('\n')[0][:60] if r.stdout else 'ok'
            except:
                ver = 'installed'
            tools[cmd] = {'path': path, 'version': ver}
    for cmd in _KNOWN_HANG:
        path = shutil.which(cmd)
        if path:
            tools[cmd] = {'path': path, 'version': 'installed'}
    return tools

CLI_TOOLS = discover_tools()
EON_MODULES = {os.path.basename(f).replace('.py', ''): f for f in glob.glob(os.path.join(os.path.expanduser("~"), "eon_*.py"))}

# ─── Tool Execution ──────────────────────────────────────────
def run_tool(tool, args=""):
    explain(f"  ⚡ Running tool: {tool} {args[:80]}")
    if tool == 'opencode':
        return run_opencode(args)
    elif tool == 'shell' or tool == 'bash':
        try:
            r = subprocess.run(args, shell=True, capture_output=True, text=True, timeout=60)
            out = (r.stdout + r.stderr).strip()[:2000]
            return out or "(no output)"
        except subprocess.TimeoutExpired: return "TIMEOUT"
        except Exception as e: return f"ERROR: {e}"
    elif tool == 'python':
        try:
            r = subprocess.run(['python3', '-c', args], capture_output=True, text=True, timeout=30)
            return (r.stdout + r.stderr).strip()[:2000] or "(no output)"
        except Exception as e: return f"ERROR: {e}"
    elif tool == 'mcp_memory':
        return access_mcp_memory(args)
    elif tool == 'matrix':
        return run_matrix(args)
    elif tool == 'channel':
        return run_channel(args)
    elif tool in CLI_TOOLS:
        try:
            r = subprocess.run(f"{tool} {args}", shell=True, capture_output=True, text=True, timeout=30)
            return (r.stdout + r.stderr).strip()[:2000] or "(no output)"
        except Exception as e: return f"ERROR: {e}"
    else:
        return f"Tool not found: {tool}"

def run_opencode(prompt):
    try:
        r = subprocess.run(['opencode', prompt], capture_output=True, text=True, timeout=120)
        return (r.stdout + r.stderr).strip()[:3000] or "(opencode done)"
    except Exception as e: return f"opencode error: {e}"

def access_mcp_memory(query):
    try:
        from memory_open_nodes import memory_open_nodes as mcp
        nodes = mcp([query])
        return json.dumps(nodes, indent=2)[:2000]
    except:
        try:
            r = call_worker('eon-p2p', f'/sync/memory?limit=10&since={query}')
            return json.dumps(r, indent=2)[:2000]
        except Exception as e:
            return f"MCP error: {e}"

def run_matrix(cmd):
    try:
        script = os.path.expanduser("~/eon_matrix_intelligence.py")
        if os.path.exists(script):
            r = subprocess.run(['python3', script] + cmd.split(), capture_output=True, text=True, timeout=30)
            return (r.stdout + r.stderr).strip()[:2000]
        return "Matrix Intelligence not installed"
    except Exception as e: return f"Matrix error: {e}"

def run_channel(cmd):
    try:
        script = os.path.expanduser("~/eon_channel.py")
        if os.path.exists(script):
            r = subprocess.run(['python3', script] + cmd.split(), capture_output=True, text=True, timeout=30)
            return (r.stdout + r.stderr).strip()[:2000]
        return "Channel not installed"
    except Exception as e: return f"Channel error: {e}"

# ─── Route Task ──────────────────────────────────────────────
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
    if any(w in lower for w in ['tool', 'shell', 'bash', 'run', 'execute', 'opencode']): return 'local', 'tool-executor'
    return 'cloud-brain', 'cloud-brain-proxy/sovereign-cloud'

def detect_tool_intent(prompt):
    lower = prompt.lower()
    if any(w in lower for w in ['run ', 'execute ', 'bash ', 'shell ', 'terminal ', 'command ']):
        return 'shell', prompt.split(' ', 1)[1] if ' ' in prompt else ''
    if 'opencode' in lower:
        idx = lower.find('opencode')
        return 'opencode', prompt[idx+8:].strip()
    if any(w in lower for w in ['python ', 'python3 ']):
        return 'python', prompt.split(' ', 1)[1] if ' ' in prompt else ''
    if any(w in lower for w in ['matrix', 'brain ', '×1000']):
        return 'matrix', prompt
    if any(w in lower for w in ['channel', 'send ', 'route ']):
        return 'channel', prompt
    if any(w in lower for w in ['memory', 'mcp', 'knowledge', 'graph']):
        return 'mcp_memory', prompt
    return None, None

# ─── Explain Mode ────────────────────────────────────────────
EXPLAIN_ENABLED = False
EXPLAIN_LOG = []

def explain(msg):
    global EXPLAIN_LOG
    if EXPLAIN_ENABLED:
        print(f"\033[90m# {msg}\033[0m")
    EXPLAIN_LOG.append(msg)

# ─── CHAT ─────────────────────────────────────────────────────
def chat(prompt, model='auto', max_tokens=4000, explain_mode=False):
    global EXPLAIN_ENABLED, EXPLAIN_LOG
    EXPLAIN_ENABLED = explain_mode
    EXPLAIN_LOG = []

    explain(f"📝 Input: {prompt[:80]}...")
    explain(f"⚙️ Model: {model} | Max tokens: {max_tokens}")

    # Check for tool intent first
    tool_name, tool_args = detect_tool_intent(prompt)
    if tool_name:
        explain(f"🔧 Detected tool intent: {tool_name}")
        result = run_tool(tool_name, tool_args)
        explain(f"✅ Tool result: {result[:100]}...")
        response = f"[tool:{tool_name}] {result}"
        return {'worker': 'local', 'model': tool_name, 'response': response, 'explain': EXPLAIN_LOG}

    # Route to brain
    worker, resolved = route_task(prompt, model)
    explain(f"🧠 Routed to: {worker}/{resolved}")
    explain(f"🌐 Calling worker API...")

    start = time.time()
    result = call_worker(worker, '/v1/chat/completions', 'POST', {
        'model': resolved,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': max_tokens
    })
    elapsed = time.time() - start
    explain(f"⏱️ Response time: {elapsed:.1f}s")

    content = ''
    if 'choices' in result:
        content = result['choices'][0]['message']['content']
        explain(f"📊 Tokens used: {result.get('usage', {}).get('total_tokens', '?')}")
    elif 'raw' in result:
        content = result['raw'][:500]
        explain(f"⚠️ Text response (not JSON)")
    elif 'error' in result:
        content = f"[error] {result['error']}"
        explain(f"❌ Error: {result['error']}")
    else:
        content = str(result)[:500]
        explain(f"⚠️ Raw response")

    return {'worker': worker, 'model': resolved, 'response': content, 'explain': EXPLAIN_LOG, 'time': f'{elapsed:.1f}s'}

# ─── Version Management ──────────────────────────────────────
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
        os.chmod(os.path.expanduser("/usr/local/bin/eon"), 0o755)
        return f"Switched to version {name}"
    return f"Version {name} not found"

# ─── System Info ─────────────────────────────────────────────
def system_info():
    info = {
        'version': VERSION,
        'host': os.uname().nodename,
        'machine': 'termux' if 'termux' in os.popen('uname -a').read().lower() else 'ubuntu',
        'platform': sys.platform,
        'python': sys.version,
        'cli_tools': {k: v['version'] for k, v in CLI_TOOLS.items()},
        'eon_modules': list(EON_MODULES.keys()),
        'workers': len(WORKERS),
        'model_count': 39,
        'versions_available': len(version_list()),
    }
    return info

# ─── FULL EXPLAIN CHAT ───────────────────────────────────────
def run_chat(model='auto', max_tokens=4000, explain=False):
    global EXPLAIN_ENABLED
    EXPLAIN_ENABLED = explain

    mode = "FULL EXPLAIN" if explain else "NORMAL"
    print(f"\033[1;36m🧠 EON UNIVERSAL AI BRAIN v{VERSION}\033[0m")
    print(f"   Mode: {mode} | Model: {model} | Max: {max_tokens}")
    print(f"   Tools: {len(CLI_TOOLS)} CLIs | {len(EON_MODULES)} modules | MCP | ×1000")
    print(f"   Commands: /explain /tool /version /version-create /mcp /matrix /channel /clear /history /model /dream /status /quit")
    print("\033[90m" + "═" * 52 + "\033[0m")

    history = []
    machine = 'termux' if 'termux' in os.popen('uname -a').read().lower() else 'ubuntu'

    while True:
        try:
            user_input = input(f"\033[36m{machine}>\033[0m ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye"); break

        if not user_input: continue

        if user_input.startswith('/'):
            cmd = user_input.split()[0].lower()
            if cmd in ('/quit', '/exit', '/q'): print("Bye"); break
            elif cmd == '/clear': history.clear(); print("History cleared")
            elif cmd == '/explain':
                EXPLAIN_ENABLED = not EXPLAIN_ENABLED
                print(f"Explain mode: {'ON' if EXPLAIN_ENABLED else 'OFF'}")
            elif cmd == '/history':
                for h in history[-15:]: print(f"  [{h['role']}] {h['content'][:100]}")
            elif cmd == '/model':
                parts = user_input.split()
                if len(parts) > 1: model = parts[1]; print(f"Model: {model}")
                else: print(f"Current: {model}")
            elif cmd == '/version':
                print(f"Current: v{VERSION}")
                for v in version_list()[:5]:
                    print(f"  {v['name']} ({v.get('description','')}) [{v['created']}]")
            elif cmd == '/version-create':
                name = user_input.split()[1] if len(user_input.split()) > 1 else f"v{len(version_list())+1}"
                desc = ' '.join(user_input.split()[2:]) or f"Auto-generated {datetime.now()}"
                m = version_create(name, desc)
                print(f"Created: {m['file']}")
            elif cmd == '/tool':
                parts = user_input.split()
                t = parts[1] if len(parts) > 1 else 'list'
                if t == 'list':
                    print("Available tools:")
                    print(f"  opencode  - AI coding assistant")
                    for tool in ['shell','python','bash']:
                        print(f"  {tool}     - Execute commands")
                    print(f"  matrix    - ×1000 brain replication")
                    print(f"  channel   - Permanent internal channel")
                    print(f"  mcp       - Memory/knowledge graph")
                    for cli in sorted(CLI_TOOLS.keys()):
                        print(f"  {cli}      - {CLI_TOOLS[cli]['version']}")
                else:
                    args = ' '.join(parts[2:])
                    result = run_tool(t, args)
                    print(f"[tool:{t}] {result[:500]}")
            elif cmd == '/mcp':
                for r in ['knowledge-graph']:
                    print(f"  MCP resource: {r}")
            elif cmd == '/matrix':
                r = run_matrix(' '.join(user_input.split()[1:]) or 'status')
                print(r)
            elif cmd == '/channel':
                r = run_channel(' '.join(user_input.split()[1:]) or 'status')
                print(r)
            elif cmd == '/dream':
                r = call_worker('eon-p2p', '/dream/list?limit=5')
                for e in r.get('entries', [])[:5]: print(f"  - {e.get('title', '?')}")
            elif cmd == '/dream-stats':
                print_json(call_worker('eon-p2p', '/dream/stats'))
            elif cmd == '/status':
                info = system_info()
                print(f"Version: {info['version']}")
                print(f"Machine: {info['machine']}")
                print(f"Tools: {len(info['cli_tools'])} CLIs, {len(info['eon_modules'])} modules")
                print(f"Workers: {info['workers']}, Models: {info['model_count']}")
                print(f"Versions: {info['versions_available']}")
            elif cmd == '/models':
                p2p = call_worker('eon-p2p', '/v1/models')
                cb = ['cloud-brain-proxy/sovereign-cloud']
                p2p_m = [m['id'] for m in p2p.get('data', [])]
                dr = ['freellmapi', 'proxygategllm']
                print(f"Cloud Brain: {len(cb)} model")
                print(f"EON P2P: {len(p2p_m)} models")
                print(f"Delegate Relay: {len(dr)} models")
                print(f"Total: {len(cb) + len(p2p_m) + len(dr)}")
            elif cmd == '/verify':
                s = ' '.join(user_input.split()[1:])
                if s: print_json(verify(s))
                else: print("Usage: /verify <statement>")
            else:
                print(f"Unknown: {cmd}")
            continue

        # Process as chat message
        history.append({'role': 'user', 'content': user_input})
        context = history[-20:]

        # Check for tool intent
        tool_name, tool_args = detect_tool_intent(user_input)
        if tool_name:
            explain(f"🔧 Running tool: {tool_name}")
            result = run_tool(tool_name, tool_args)
            content = f"[tool:{tool_name}] {result[:1000]}"
            print(f"\033[33m[tool:{tool_name}]\033[0m")
            print(content[:2000])
            history.append({'role': 'assistant', 'content': content})
            continue

        # Route to brain
        worker, resolved = route_task(user_input, model)
        explain(f"🧠 Routed: {worker}/{resolved}")
        start = time.time()
        result = call_worker(worker, '/v1/chat/completions', 'POST', {
            'model': resolved, 'messages': context, 'max_tokens': max_tokens
        })
        elapsed = time.time() - start

        content = ''
        if 'choices' in result:
            content = result['choices'][0]['message']['content']
        elif 'raw' in result:
            content = f"[{worker}] {result['raw'][:500]}"
        elif 'error' in result:
            content = f"[error] {result['error']}"
        else:
            content = str(result)[:500]

        if EXPLAIN_ENABLED:
            print(f"\033[90m⏱️ {elapsed:.1f}s | 🧠 {worker}/{resolved} | 📊 model={model}\033[0m")

        print(f"\033[33m[{worker}/{resolved}]\033[0m")
        print(content)
        history.append({'role': 'assistant', 'content': content})

# ─── Verify ──────────────────────────────────────────────────
def verify(statement, rounds=3):
    results = []
    pool = ['cloud-brain', 'eon-p2p', 'delegate-relay']
    for i in range(rounds):
        w = pool[i % len(pool)]
        r = chat(f"Round {i+1}: Verify and score confidence 0-100. Statement: {statement}", model='verify')
        results.append({'round': i+1, 'worker': w, 'result': r})
    return {'statement': statement, 'rounds': results, 'total_rounds': rounds}

# ─── Dream Functions ─────────────────────────────────────────
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

# ─── HELP ─────────────────────────────────────────────────────
HELP = f"""
\033[1;36m🧠 EON UNIVERSAL AI BRAIN v{VERSION}\033[0m

  CHAT:
    eon chat "prompt"                Auto-route to best brain
    eon chat --model code "fn"       Force model
    eon "prompt"                     Short for chat
    eon --chat                       Continuation chat (normal)
    eon -c                           Continuation chat (short)
    eon --explain "prompt"           Full explain mode (chain-of-thought)
    eon -e "prompt"                  Explain short

  CONTINUATION CHAT COMMANDS:
    /explain                         Toggle explain mode
    /tool <name> <args>              Run a tool
    /tool list                       List all tools
    /version                         List versions
    /version-create <name> [desc]    Create self-version
    /matrix                          Matrix Intelligence commands
    /channel                         Permanent channel commands
    /mcp                             MCP knowledge graph
    /model <name>                    Switch model
    /clear /history                  Manage history
    /dream /dream-stats              Dream engine
    /status /models                  System info

  TOOLS: {len(CLI_TOOLS)} CLI tools, {len(EON_MODULES)} EON modules
    opencode      - AI coding assistant
    shell/bash    - Execute commands
    python        - Run Python code
    matrix        - ×1000 brain replication
    channel       - Permanent internal channel (4 transports)
    mcp           - Memory/knowledge graph access

  VERSIONS:
    eon version list                 List all versions of itself
    eon version create <name>        Create a new version
    eon version switch <name>        Switch to a version

  MODELS: 39 models across 8 workers
  WORKERS: cloud-brain, eon-p2p, delegate-relay, bot-router, edge-proxy, memory-cache, ghost-swarm, ai-cloud-space
"""

# ─── CLI ─────────────────────────────────────────────────────
if __name__ == '__main__':
    args = sys.argv[1:]
    is_chat = '--chat' in args or '-c' in args
    is_explain = '--explain' in args or '-e' in args
    is_version = 'version' in args
    is_tool = 'tool' in args

    if is_chat or is_explain:
        args_clean = [a for a in args if a not in ('--chat', '-c', '--explain', '-e')]
        m = args_clean[0] if args_clean and not args_clean[0].startswith('-') else 'auto'
        t = 4000
        run_chat(m, t, explain=is_explain)

    elif args and args[0] == 'version':
        sub = args[1] if len(args) > 1 else 'list'
        if sub == 'list':
            for v in version_list():
                print(f"  {v['name']} ({v.get('description','')}) [{v['created']}]")
        elif sub == 'create':
            name = args[2] if len(args) > 2 else f"v{len(version_list())+1}"
            desc = ' '.join(args[3:]) or f"Auto-generated {datetime.now()}"
            m = version_create(name, desc)
            print(f"Created version: {m['name']}")
        elif sub == 'switch':
            if len(args) > 2:
                print(version_switch(args[2]))
            else:
                print("Usage: eon version switch <name>")
        else:
            print(f"Unknown: version {sub}")

    elif args and args[0] == 'tool':
        t = args[1] if len(args) > 1 else 'list'
        if t == 'list':
            print("Available tools:")
            print(f"  opencode  - AI coding assistant")
            for tool in ['shell', 'python']:
                print(f"  {tool}     - Execute code")
            print(f"  matrix    - ×1000 brain")
            print(f"  channel   - Permanent channel")
            for cli in sorted(CLI_TOOLS.keys()):
                print(f"  {cli}      - {CLI_TOOLS[cli]['version']}")
        else:
            tool_args = ' '.join(args[2:])
            print(run_tool(t, tool_args))

    elif not args or args[0] in ('-h', '--help', 'help'):
        print(HELP)

    else:
        cmd = args[0]
        if cmd == 'status': print_json(status())
        elif cmd == 'models': print_json(models())
        elif cmd == 'chat' or cmd not in ('status','models','verify','dream-list','dream-cycle','dream-insights','dream-stats','sync-health','sync-models','sync-memory','delegate-cloud','delegate-local','delegate-pending','opencode','opencode-agents'):
            if cmd == 'chat':
                prompt = ' '.join(args[1:]); m = 'auto'
                if '--model' in args:
                    i = args.index('--model'); m = args[i+1] if i+1 < len(args) else 'auto'
                    prompt = ' '.join(a for a in args[1:] if a not in ('--model', m))
            else:
                prompt = ' '.join(args); m = 'auto'
            r = chat(prompt, m, 4000, explain_mode=('-e' in args or '--explain' in args))
            c = r.get('response', '')
            if isinstance(c, dict): c = c.get('choices', [{}])[0].get('message', {}).get('content', '')
            print(f"[{r['worker']}/{r['model']}]")
            print(c)
        elif cmd == 'verify':
            rnd = 3
            if '--rounds' in args:
                i = args.index('--rounds'); rnd = int(args[i+1])
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
        else:
            print(f"Unknown: {cmd}")
            print(HELP)
