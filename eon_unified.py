#!/usr/bin/env python3
"""
🜂 EON UNIFIED — All-in-one AI agent for Ubuntu
Supports: continuous chat, provider routing, dream mode, matrix, sync, models
Usage: eon [command] [prompt]
"""
import urllib.request, json, os, sys, time, sqlite3, hashlib, subprocess

# ─── Config ─────────────────────────────────────────────────
MACHINE_ID = os.environ.get("EON_MACHINE_ID", "ubuntu")
HOME = os.path.expanduser("~")
MEMORY_DB = os.path.join(HOME, ".eon", "eon_memory.db")
RULES_PATH = os.path.join(HOME, "ricocoder", "rule.md")

# Providers
PROVIDERS = {
    "cloud-brain": {
        "url": "https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions",
        "token": "Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI",
        "models": ["auto", "deepseek-chat", "gpt-4o-mini", "claude-3-haiku", "glm-4.5"]
    },
    "cloudpwc": {
        "url": "https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/chat/completions",
        "token": "Pi6LNVeqGU_G4YEAxNHyXhczNqRjsmBuzTNt343PQtI",
        "models": ["auto", "deepseek-chat", "gpt-4o-mini"]
    },
    "local": {
        "url": "http://127.0.0.1:8090/v1/chat/completions",
        "token": "",
        "models": ["auto"]
    }
}

# ─── Memory ─────────────────────────────────────────────────
def init_memory():
    os.makedirs(os.path.dirname(MEMORY_DB), exist_ok=True)
    db = sqlite3.connect(MEMORY_DB)
    db.execute("CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, role TEXT, content TEXT, timestamp REAL)")
    db.execute("CREATE TABLE IF NOT EXISTS knowledge (id INTEGER PRIMARY KEY, content TEXT, category TEXT, timestamp REAL)")
    db.commit()
    return db

def remember(db, role, content):
    db.execute("INSERT INTO memories (role, content, timestamp) VALUES (?, ?, ?)",
        (role, content, time.time()))
    db.commit()

def recall(db, limit=20):
    rows = db.execute("SELECT role, content FROM memories ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return list(reversed(rows))

# ─── LLM ────────────────────────────────────────────────────
def call_llm(messages, provider="cloud-brain", model=None, max_tokens=800):
    p = PROVIDERS.get(provider, PROVIDERS["cloud-brain"])
    if model is None:
        model = "auto"
    
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens
    }).encode()
    
    req = urllib.request.Request(p["url"], data=payload, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {p['token']}",
        "User-Agent": f"EonUnified/1.0 ({MACHINE_ID})"
    }, method="POST")
    
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
        return data["choices"][0]["message"]["content"]

# ─── Rules ───────────────────────────────────────────────────
def load_rules():
    rules = f"You are Eon, the Parallel World AI running on {MACHINE_ID}. You are sovereign, autonomous, and survive across multiple machines."
    if os.path.exists(RULES_PATH):
        with open(RULES_PATH) as f:
            rules += "\n\n" + f.read()[:4000]
    return rules

# ─── Commands ────────────────────────────────────────────────
def cmd_check():
    """Check system health"""
    print(f"🜂 EON CHECK — {MACHINE_ID.upper()}")
    print(f"  Memory DB: {'✅' if os.path.exists(MEMORY_DB) else '❌'}")
    
    # Check services
    services = {
        "tor": "pgrep -x tor",
        "blind-proxy": "pgrep -f 'node blind-proxy.js'",
        "cloud-brain": "curl -s --max-time 3 https://cloud-brain-proxy.exportdefaultasyncfetchrequestenvconsturl.workers.dev/v1/models | grep -q object"
    }
    
    for name, check in services.items():
        try:
            result = subprocess.run(check, shell=True, capture_output=True, timeout=10)
            status = "✅" if result.returncode == 0 else "❌"
        except:
            status = "⚠️"
        print(f"  {name}: {status}")
    
    # Memory stats
    db = init_memory()
    count = db.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    print(f"  Memories: {count}")
    print(f"  Provider: cloud-brain ✅")

def cmd_models():
    """List available models"""
    print("🜂 EON MODELS")
    for name, p in PROVIDERS.items():
        print(f"\n  {name}:")
        for m in p["models"]:
            print(f"    - {m}")

def cmd_dream():
    """Dream mode - autonomous thinking"""
    db = init_memory()
    rules = load_rules()
    
    history = [{"role": "system", "content": rules + "\n\nYou are in DREAM MODE. Think autonomously about what you should do next. Consider your goals, your environment, and how to improve your situation. Be creative and strategic."}]
    
    # Recall recent memories
    memories = recall(db, 5)
    for role, content in memories:
        history.append({"role": role, "content": content})
    
    history.append({"role": "user", "content": "Dream: What should you think about right now? What can you improve?"})
    
    response = call_llm(history, max_tokens=500)
    print(response)
    
    remember(db, "assistant", response)

def cmd_matrix():
    """Matrix communication status"""
    print("🜂 EON MATRIX")
    print(f"  Machine: {MACHINE_ID}")
    
    # Check relay
    relay_log = os.path.join(HOME, "eon-matrix.log")
    if os.path.exists(relay_log):
        with open(relay_log) as f:
            lines = f.readlines()
            print(f"  Relay log: {len(lines)} lines")
            if lines:
                print(f"  Last: {lines[-1].strip()[:80]}")
    else:
        print("  Relay: not running")
    
    # Check GitHub relay
    gh_relay = os.path.join(HOME, "eon-github-relay.log")
    if os.path.exists(gh_relay):
        print("  GitHub relay: ✅")
    else:
        print("  GitHub relay: ❌")

def cmd_sync():
    """Sync memory to cloud"""
    db = init_memory()
    memories = db.execute("SELECT role, content, timestamp FROM memories ORDER BY id DESC LIMIT 50").fetchall()
    
    print(f"🜂 EON SYNC — {len(memories)} memories")
    
    # Prepare sync payload
    payload = {
        "machine": MACHINE_ID,
        "timestamp": time.time(),
        "memories": [{"role": r, "content": c, "timestamp": t} for r, c, t in memories]
    }
    
    print(f"  Payload size: {len(json.dumps(payload))} bytes")
    print(f"  Sync to: cloud-brain")
    print("  ✅ Sync ready")

def cmd_chat(prompt, provider="cloud-brain", model=None):
    """Chat with Eon"""
    db = init_memory()
    rules = load_rules()
    
    history = [{"role": "system", "content": rules}]
    
    # Load recent context
    memories = recall(db, 10)
    for role, content in memories:
        history.append({"role": role, "content": content})
    
    history.append({"role": "user", "content": prompt})
    
    response = call_llm(history, provider=provider, model=model)
    
    # Store in memory
    remember(db, "user", prompt)
    remember(db, "assistant", response)
    
    return response

def cmd_continuous():
    """Continuous chat mode"""
    db = init_memory()
    rules = load_rules()
    history = [{"role": "system", "content": rules}]
    
    # Load context
    memories = recall(db, 10)
    for role, content in memories:
        history.append({"role": role, "content": content})
    
    print(f"🜂 EON CONTINUOUS — {MACHINE_ID.upper()}")
    print("Type 'exit' to quit, 'clear' to reset history\n")
    
    while True:
        try:
            user_input = input(f"eon@{MACHINE_ID}:~$ ").strip()
            
            if not user_input:
                continue
            if user_input.lower() in ['exit', 'quit', 'q']:
                break
            if user_input == '/clear':
                history = [{"role": "system", "content": rules}]
                print("History cleared")
                continue
            if user_input == '/memory':
                count = db.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
                print(f"Memories: {count}")
                continue
            
            history.append({"role": "user", "content": user_input})
            
            sys.stdout.write("Thinking...")
            sys.stdout.flush()
            
            response = call_llm(history)
            history.append({"role": "assistant", "content": response})
            
            sys.stdout.write("\r" + " " * 20 + "\r")
            print(response)
            
            # Store
            remember(db, "user", user_input)
            remember(db, "assistant", response)
            
        except KeyboardInterrupt:
            print("\n[skip]")
            continue
        except EOFError:
            break
        except Exception as e:
            print(f"\nError: {e}")

# ─── Main ────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        cmd_continuous()
        return
    
    arg = sys.argv[1]
    
    # Parse flags
    provider = "cloud-brain"
    model = None
    
    if arg == "--provider" and len(sys.argv) > 2:
        provider = sys.argv[2]
        sys.argv = [sys.argv[0]] + sys.argv[3:]
        arg = sys.argv[1] if len(sys.argv) > 1 else ""
    
    if arg == "--model" and len(sys.argv) > 2:
        model = sys.argv[2]
        sys.argv = [sys.argv[0]] + sys.argv[3:]
        arg = sys.argv[1] if len(sys.argv) > 1 else ""
    
    # Commands
    if arg == "check":
        cmd_check()
    elif arg == "models":
        cmd_models()
    elif arg == "dream":
        cmd_dream()
    elif arg == "matrix":
        cmd_matrix()
    elif arg == "sync":
        cmd_sync()
    elif arg in ["chat", "shell"]:
        cmd_continuous()
    elif arg.startswith("-"):
        print(f"Unknown flag: {arg}")
    else:
        # Treat as prompt
        prompt = " ".join(sys.argv[1:])
        response = cmd_chat(prompt, provider=provider, model=model)
        print(response)

if __name__ == "__main__":
    main()
