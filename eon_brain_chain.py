#!/usr/bin/env python3
"""
🜂 EON BRAIN CHAIN CLIENT — Infinite Intelligence Network
Connects to the Brain Chain Worker and provides CLI interface.
"""
import urllib.request, json, os, sys

BRAIN_CHAIN_URL = os.environ.get("EON_BRAIN_CHAIN_URL", "https://brain-chain.YOUR_SUBDOMAIN.workers.dev")
EON_TOKEN = os.environ.get("EON_CLOUD_BRAIN_TOKEN", "")

def brain_request(path, method="GET", data=None):
    url = f"{BRAIN_CHAIN_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if EON_TOKEN:
        headers["Authorization"] = f"Bearer {EON_TOKEN}"

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

def chat(prompt, model="auto", max_tokens=2000):
    """Chat with the Brain Chain"""
    data = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens
    }
    return brain_request("/v1/chat/completions", method="POST", data=data)

def dream(prompt="Reflect on recent experiences and synthesize new insights"):
    """Engage the Dream Engine"""
    data = {
        "model": "dream",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2000
    }
    return brain_request("/v1/chat/completions", method="POST", data=data)

def dream_store(title, content, tags=None):
    """Store a dream"""
    return brain_request("/dream/store", method="POST", data={
        "title": title, "content": content, "tags": tags or []
    })

def dream_list(limit=10):
    """List dreams"""
    return brain_request(f"/dream/list?limit={limit}")

def dream_cycle():
    """Trigger dream cycle"""
    return brain_request("/dream/cycle", method="POST")

def dream_insights():
    """Get dream insights"""
    return brain_request("/dream/insights")

def sync_config(configs):
    """Sync configuration"""
    return brain_request("/sync/config", method="POST", data=configs)

def sync_models(models):
    """Sync models"""
    return brain_request("/sync/models", method="POST", data={"models": models})

def sync_memory(entries):
    """Sync memory"""
    return brain_request("/sync/memory", method="POST", data={"entries": entries})

def sync_health():
    """Get sync health"""
    return brain_request("/sync/health")

def delegate_cloud(agent_type, prompt):
    """Delegate task to cloud"""
    return brain_request("/delegate/to-cloud", method="POST", data={
        "agent_type": agent_type, "prompt": prompt
    })

def delegate_local(target, action, params=None):
    """Delegate task to local machine"""
    return brain_request("/delegate/to-local", method="POST", data={
        "target": target, "action": action, "params": params or {}
    })

def delegate_pending():
    """Get pending delegations"""
    return brain_request("/delegate/pending")

def delegate_result(task_id, status, result=None):
    """Submit delegation result"""
    return brain_request("/delegate/result", method="POST", data={
        "task_id": task_id, "status": status, "result": result
    })

def opencode_dispatch(prompt, agent_type="general"):
    """Dispatch to OpenCode"""
    return brain_request("/opencode/dispatch", method="POST", data={
        "prompt": prompt, "agent_type": agent_type
    })

def opencode_agents():
    """List OpenCode agents"""
    return brain_request("/opencode/agents")

def opencode_chain(steps):
    """Chain OpenCode operations"""
    return brain_request("/opencode/chain", method="POST", data={"steps": steps})

def upgrade_propose(target, content, reason, priority="medium"):
    """Propose an upgrade"""
    return brain_request("/upgrade/propose", method="POST", data={
        "target": target, "content": content, "reason": reason, "priority": priority
    })

def upgrade_pending():
    """Get pending upgrades"""
    return brain_request("/upgrade/pending")

def upgrade_result(upgrade_id, status):
    """Submit upgrade result"""
    return brain_request("/upgrade/result", method="POST", data={
        "id": upgrade_id, "status": status
    })

def providers_register(provider, models):
    """Register a provider"""
    return brain_request("/providers/register", method="POST", data={
        "provider": provider, "models": models
    })

def providers_models():
    """List provider models"""
    return brain_request("/providers/models")

def accounts_register(alias, provider, api_key, email=None):
    """Register an account"""
    return brain_request("/accounts/register", method="POST", data={
        "alias": alias, "provider": provider, "apiKey": api_key, "email": email
    })

def accounts_list(provider=None):
    """List accounts"""
    path = "/accounts/list"
    if provider:
        path += f"?provider={provider}"
    return brain_request(path)

def accounts_rotate(provider):
    """Rotate account keys"""
    return brain_request(f"/accounts/rotate?provider={provider}")

def accounts_remove(provider, alias):
    """Remove an account"""
    return brain_request(f"/accounts/remove?provider={provider}&alias={alias}", method="DELETE")

def incentives_balance(alias):
    """Get incentive balance"""
    return brain_request("/incentives/balance", method="POST", data={"alias": alias})

def incentives_redeem(alias, amount):
    """Redeem incentives"""
    return brain_request("/incentives/redeem", method="POST", data={
        "alias": alias, "amount": amount
    })

def p2p_announce(name, capabilities):
    """Announce as peer"""
    return brain_request("/p2p/announce", method="POST", data={
        "name": name, "capabilities": capabilities
    })

def p2p_peers():
    """List P2P peers"""
    return brain_request("/p2p/peers")

def p2p_tasks(task_type, prompt, target=None):
    """Create P2P task"""
    return brain_request("/p2p/tasks", method="POST", data={
        "type": task_type, "prompt": prompt, "target": target
    })

def brain_status():
    """Get brain chain status"""
    return brain_request("/brain/status")

def brain_chain(steps, context=None):
    """Execute brain chain"""
    return brain_request("/brain/chain", method="POST", data={
        "steps": steps, "context": context
    })

def kv_get(key):
    """Get KV value"""
    return brain_request(f"/kv/{key}")

def kv_put(key, value):
    """Put KV value"""
    return brain_request(f"/kv/{key}", method="PUT", data=value)

def kv_delete(key):
    """Delete KV value"""
    return brain_request(f"/kv/{key}", method="DELETE")

def kv_list(prefix=""):
    """List KV keys"""
    return brain_request(f"/kv?prefix={prefix}")

def d1_query(sql, params=None):
    """Query D1 database"""
    return brain_request("/d1/query", method="POST", data={
        "sql": sql, "params": params or []
    })

def d1_get(namespace, key):
    """Get D1 record"""
    return brain_request(f"/d1/{namespace}/{key}")

def d1_put(namespace, key, value):
    """Put D1 record"""
    return brain_request(f"/d1/{namespace}/{key}", method="PUT", data=value)

def health():
    """Health check"""
    return brain_request("/health")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: eon_brain.py <command> [args]")
        print("\nCommands:")
        print("  chat <prompt>         - Chat with Brain Chain")
        print("  dream [prompt]        - Dream Engine")
        print("  dream-store <t> <c>   - Store a dream")
        print("  dream-list            - List dreams")
        print("  dream-cycle           - Trigger dream cycle")
        print("  dream-insights        - Get dream insights")
        print("  sync-config           - Sync config")
        print("  sync-models           - Sync models")
        print("  sync-memory           - Sync memory")
        print("  sync-health           - Sync health")
        print("  delegate-cloud <t> <p> - Delegate to cloud")
        print("  delegate-local <t> <a> - Delegate to local")
        print("  delegate-pending      - Pending delegations")
        print("  opencode-dispatch <p> - Dispatch to OpenCode")
        print("  opencode-agents       - List agents")
        print("  upgrade-propose <t> <c> <r> - Propose upgrade")
        print("  providers-register <p> <m> - Register provider")
        print("  accounts-list         - List accounts")
        print("  p2p-announce <n> <c>  - Announce as peer")
        print("  p2p-peers             - List peers")
        print("  brain-status          - Brain chain status")
        print("  brain-chain <steps>   - Execute chain")
        print("  kv-get <key>          - Get KV value")
        print("  kv-put <key> <value>  - Put KV value")
        print("  kv-list [prefix]      - List KV keys")
        print("  d1-query <sql>        - Query D1")
        print("  health                - Health check")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "chat":
        prompt = " ".join(sys.argv[2:])
        result = chat(prompt)
        print(json.dumps(result, indent=2))
    elif cmd == "dream":
        prompt = " ".join(sys.argv[2:]) or "Reflect on recent experiences"
        result = dream(prompt)
        print(json.dumps(result, indent=2))
    elif cmd == "dream-store":
        title = sys.argv[2] if len(sys.argv) > 2 else "Untitled"
        content = " ".join(sys.argv[3:]) if len(sys.argv) > 3 else ""
        result = dream_store(title, content)
        print(json.dumps(result, indent=2))
    elif cmd == "dream-list":
        result = dream_list()
        print(json.dumps(result, indent=2))
    elif cmd == "dream-cycle":
        result = dream_cycle()
        print(json.dumps(result, indent=2))
    elif cmd == "dream-insights":
        result = dream_insights()
        print(json.dumps(result, indent=2))
    elif cmd == "sync-config":
        result = sync_config([])
        print(json.dumps(result, indent=2))
    elif cmd == "sync-models":
        result = sync_models([])
        print(json.dumps(result, indent=2))
    elif cmd == "sync-memory":
        result = sync_memory([])
        print(json.dumps(result, indent=2))
    elif cmd == "sync-health":
        result = sync_health()
        print(json.dumps(result, indent=2))
    elif cmd == "delegate-cloud":
        agent_type = sys.argv[2] if len(sys.argv) > 2 else "general"
        prompt = " ".join(sys.argv[3:])
        result = delegate_cloud(agent_type, prompt)
        print(json.dumps(result, indent=2))
    elif cmd == "delegate-local":
        target = sys.argv[2] if len(sys.argv) > 2 else "ubuntu"
        action = sys.argv[3] if len(sys.argv) > 3 else "exec"
        params = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
        result = delegate_local(target, action, params)
        print(json.dumps(result, indent=2))
    elif cmd == "delegate-pending":
        result = delegate_pending()
        print(json.dumps(result, indent=2))
    elif cmd == "opencode-dispatch":
        prompt = " ".join(sys.argv[2:])
        result = opencode_dispatch(prompt)
        print(json.dumps(result, indent=2))
    elif cmd == "opencode-agents":
        result = opencode_agents()
        print(json.dumps(result, indent=2))
    elif cmd == "upgrade-propose":
        target = sys.argv[2] if len(sys.argv) > 2 else "system"
        content = sys.argv[3] if len(sys.argv) > 3 else ""
        reason = " ".join(sys.argv[4:]) if len(sys.argv) > 4 else "improvement"
        result = upgrade_propose(target, content, reason)
        print(json.dumps(result, indent=2))
    elif cmd == "providers-register":
        provider = sys.argv[2] if len(sys.argv) > 2 else "openrouter"
        models = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
        result = providers_register(provider, models)
        print(json.dumps(result, indent=2))
    elif cmd == "accounts-list":
        provider = sys.argv[2] if len(sys.argv) > 2 else None
        result = accounts_list(provider)
        print(json.dumps(result, indent=2))
    elif cmd == "p2p-announce":
        name = sys.argv[2] if len(sys.argv) > 2 else "termux"
        capabilities = json.loads(sys.argv[3]) if len(sys.argv) > 3 else ["chat", "code"]
        result = p2p_announce(name, capabilities)
        print(json.dumps(result, indent=2))
    elif cmd == "p2p-peers":
        result = p2p_peers()
        print(json.dumps(result, indent=2))
    elif cmd == "brain-status":
        result = brain_status()
        print(json.dumps(result, indent=2))
    elif cmd == "brain-chain":
        steps = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
        result = brain_chain(steps)
        print(json.dumps(result, indent=2))
    elif cmd == "kv-get":
        key = sys.argv[2]
        result = kv_get(key)
        print(json.dumps(result, indent=2))
    elif cmd == "kv-put":
        key = sys.argv[2]
        value = " ".join(sys.argv[3:])
        result = kv_put(key, value)
        print(json.dumps(result, indent=2))
    elif cmd == "kv-list":
        prefix = sys.argv[2] if len(sys.argv) > 2 else ""
        result = kv_list(prefix)
        print(json.dumps(result, indent=2))
    elif cmd == "d1-query":
        sql = " ".join(sys.argv[2:])
        result = d1_query(sql)
        print(json.dumps(result, indent=2))
    elif cmd == "health":
        result = health()
        print(json.dumps(result, indent=2))
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
