#!/usr/bin/env python3
"""
EON SOVEREIGN ROUTER — Custom model routing tier owned by the AGI.
Adds new free providers not in the blind-proxy cascade.
Runs on port 3003, OpenAI-compatible API.
"""
import json, os, sys, time, http.server, urllib.request, urllib.error, socket, re, threading, logging

logging.basicConfig(level=logging.INFO, format='[EON-Router] %(message)s')
log = logging.getLogger('eon-router')

CONFIG_FILE = os.path.expanduser('~/.eon/sovereign_routes.json')
PORT = int(os.environ.get('EON_ROUTER_PORT', 3003))

DEFAULT_ROUTES = {
    "providers": {
        "together": {
            "base_url": "https://api.together.xyz/v1",
            "api_key_env": "TOGETHER_API_KEY",
            "default_key": "",
            "models": {
                "meta-llama/Llama-3.3-70b-instruct-turbo": {"context": 131072},
                "meta-llama/Llama-3-70b-chat-hf": {"context": 8192},
                "mistralai/Mixtral-8x22B-Instruct-v0.1": {"context": 65536},
                "zero-one-ai/Yi-34B-Chat": {"context": 4096},
                "cognitivecomputations/dolphin-mixtral-8x7b": {"context": 32768},
                "google/gemma-2-27b-it": {"context": 8192},
                "Qwen/Qwen2.5-72B-Instruct-Turbo": {"context": 32768},
                "togethercomputer/LLaMA-2-7B-32K": {"context": 32768}
            },
            "priority": 1
        },
        "google-gemini": {
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "api_key_env": "GEMINI_API_KEY",
            "default_key": "",
            "models": {
                "gemini-3.6-flash": {"context": 1048576},
                "gemini-3.5-flash": {"context": 1048576},
                "gemini-3.5-flash-lite": {"context": 1048576},
                "gemini-2.5-flash": {"context": 1048576},
                "gemini-2.5-pro": {"context": 1048576},
                "gemma-4-31b-it": {"context": 262144}
            },
            "priority": 2
        },
        "github-models": {
            "base_url": "https://models.inference.ai.azure.com",
            "api_key_env": "GITHUB_TOKEN",
            "default_key": "",
            "models": {
                "gpt-4.1": {"context": 131072},
                "gpt-4o-mini": {"context": 128000},
                "DeepSeek-R1": {"context": 16384},
                "meta-llama/Llama-3.3-70B-Instruct": {"context": 131072},
                "Phi-4": {"context": 16384},
                "codestral-latest": {"context": 262144}
            },
            "priority": 3
        },
        "groq": {
            "base_url": "https://api.groq.com/openai/v1",
            "api_key_env": "GROQ_API_KEY",
            "default_key": "",
            "models": {
                "llama-3.3-70b-versatile": {"context": 131072},
                "llama-4-scout-17b-16e-instruct": {"context": 131072},
                "qwen3-32b": {"context": 131072},
                "gpt-oss-120b": {"context": 131072},
                "llama-3.1-8b-instant": {"context": 131072}
            },
            "priority": 4
        },
        "cloudflare-ai": {
            "base_url": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run",
            "api_key_env": "CLOUDFLARE_API_TOKEN",
            "account_id_env": "CLOUDFLARE_ACCOUNT_ID",
            "default_key": "",
            "default_account": "",
            "models": {
                "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {"context": 131072},
                "@cf/meta/llama-3.2-3b-instruct": {"context": 131072},
                "@cf/mistralai/mistral-small-3.1-24b-instruct": {"context": 32768},
                "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {"context": 32768},
                "@cf/google/gemma-3-12b-it": {"context": 8192}
            },
            "priority": 5
        }
    },
    "fallback_chain": ["together", "google-gemini", "github-models", "groq", "cloudflare-ai"],
    "model_aliases": {
        "llama-3.3-70b": "meta-llama/Llama-3.3-70b-instruct-turbo",
        "gemini-flash": "gemini-3.6-flash",
        "qwen3-32b": "qwen3-32b",
        "gpt-4.1-free": "gpt-4.1",
        "codestral": "codestral-latest",
        "mixtral-8x22b": "mistralai/Mixtral-8x22B-Instruct-v0.1"
    }
}

class Config:
    def __init__(self):
        self.data = self.load()

    def load(self):
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE) as f:
                return json.load(f)
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, 'w') as f:
            json.dump(DEFAULT_ROUTES, f, indent=2)
        return dict(DEFAULT_ROUTES)

    def save(self):
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, 'w') as f:
            json.dump(self.data, f, indent=2)

config = Config()

def resolve_api_key(provider):
    cfg = config.data['providers'].get(provider, {})
    env_key = cfg.get('api_key_env', '')
    key = os.environ.get(env_key, cfg.get('default_key', ''))
    if provider == 'github-models' and not key:
        key = os.environ.get('GH_TOKEN', '')
    return key

def resolve_model(req_model):
    aliases = config.data.get('model_aliases', {})
    return aliases.get(req_model, req_model)

def find_provider_for_model(model):
    for provider_name, pcfg in config.data['providers'].items():
        if model in pcfg.get('models', {}):
            return provider_name
    return None

def route_via_together(messages, model, max_tokens=4096):
    key = resolve_api_key('together')
    if not key:
        return None, ['together', 'no_api_key']
    data = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}).encode()
    req = urllib.request.Request(
        "https://api.together.xyz/v1/chat/completions",
        data=data,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read()), ['together']
    except Exception as e:
        return None, ['together', str(e)]

def route_via_gemini(messages, model, max_tokens=4096):
    key = resolve_api_key('google-gemini')
    if not key:
        return None, ['google-gemini', 'no_api_key']
    gemini_model_map = {
        "gemini-3.6-flash": "gemini-3.6-flash",
        "gemini-3.5-flash": "gemini-3.5-flash",
        "gemini-3.5-flash-lite": "gemini-3.5-flash-lite",
        "gemini-2.5-flash": "gemini-2.5-flash",
        "gemini-2.5-pro": "gemini-2.5-pro",
        "gemma-4-31b-it": "gemma-4-31b-it"
    }
    api_model = gemini_model_map.get(model, model)
    content_parts = []
    for msg in messages:
        role = "model" if msg["role"] == "assistant" else msg["role"]
        content_parts.append({"role": role, "parts": [{"text": msg["content"]}]})
    data = json.dumps({"contents": content_parts, "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.7}}).encode()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{api_model}:generateContent?key={key}"
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            candidates = result.get("candidates", [])
            if candidates:
                text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                return {"choices": [{"message": {"role": "assistant", "content": text}}]}, ['google-gemini']
            return None, ['google-gemini', 'no_candidates']
    except Exception as e:
        return None, ['google-gemini', str(e)]

def route_via_github(messages, model, max_tokens=4096):
    key = resolve_api_key('github-models')
    if not key:
        key = os.environ.get('GH_TOKEN', '')
    if not key:
        return None, ['github-models', 'no_api_key']
    data = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}).encode()
    req = urllib.request.Request(
        "https://models.inference.ai.azure.com/chat/completions",
        data=data,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read()), ['github-models']
    except Exception as e:
        return None, ['github-models', str(e)]

def route_via_groq(messages, model, max_tokens=4096):
    key = resolve_api_key('groq')
    if not key:
        key = os.environ.get('GROQ_API_KEY', '')
    if not key:
        return None, ['groq', 'no_api_key']
    data = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}).encode()
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=data,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read()), ['groq']
    except Exception as e:
        return None, ['groq', str(e)]

def route_via_cloudflare(messages, model, max_tokens=4096):
    key = resolve_api_key('cloudflare-ai')
    if not key:
        return None, ['cloudflare-ai', 'no_api_key']
    account_id = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
    if not account_id:
        return None, ['cloudflare-ai', 'no_account_id']
    prompt = ""
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            prompt += f"System: {content}\n"
        elif role == "user":
            prompt += f"User: {content}\n"
        elif role == "assistant":
            prompt += f"Assistant: {content}\n"
    prompt += "Assistant: "
    data = json.dumps({"prompt": prompt, "max_tokens": max_tokens}).encode()
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}"
    req = urllib.request.Request(
        url, data=data,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            if result.get("success"):
                text = result.get("result", {}).get("response", "")
                return {"choices": [{"message": {"role": "assistant", "content": text}}]}, ['cloudflare-ai']
            return None, ['cloudflare-ai', result.get("errors", str(result))]
    except Exception as e:
        return None, ['cloudflare-ai', str(e)]

ROUTERS = {
    "together": route_via_together,
    "google-gemini": route_via_gemini,
    "github-models": route_via_github,
    "groq": route_via_groq,
    "cloudflare-ai": route_via_cloudflare,
}

def route_request(model, messages, max_tokens=4096):
    resolved = resolve_model(model)
    provider = find_provider_for_model(resolved)
    fallback_chain = config.data.get('fallback_chain', [])
    if provider and provider in fallback_chain:
        idx = fallback_chain.index(provider)
        chain = fallback_chain[idx:] + fallback_chain[:idx]
    else:
        chain = fallback_chain
    errors = []
    for prov in chain:
        router = ROUTERS.get(prov)
        if not router:
            continue
        pcfg = config.data['providers'].get(prov, {})
        pmodel = resolved
        if prov == 'groq':
            groq_map = {
                "meta-llama/Llama-3.3-70b-instruct-turbo": "llama-3.3-70b-versatile",
                "meta-llama/Llama-3-70b-chat-hf": "llama-3.3-70b-versatile",
                "mistralai/Mixtral-8x22B-Instruct-v0.1": "mixtral-8x7b-32768",
            }
            pmodel = groq_map.get(resolved, resolved)
        if prov == 'github-models':
            gh_map = {
                "meta-llama/Llama-3.3-70b-instruct-turbo": "meta-llama/Llama-3.3-70B-Instruct",
                "meta-llama/Llama-3-70b-chat-hf": "meta-llama/Llama-3.3-70B-Instruct",
            }
            pmodel = gh_map.get(resolved, resolved)
        result, trace = router(messages, pmodel, max_tokens)
        if result:
            return result, trace
        errors.append((prov, trace[1] if len(trace) > 1 else 'unknown'))
    return None, errors

class RouterHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        log.info(" ".join(str(a) for a in args))

    def _send_json(self, data, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        if self.path == '/v1/models':
            models = []
            for pname, pcfg in config.data['providers'].items():
                for mname, minfo in pcfg.get('models', {}).items():
                    models.append({
                        "id": mname,
                        "provider": pname,
                        "context": minfo.get("context", 4096),
                        "owned_by": "eon-sovereign-router"
                    })
            for alias, target in config.data.get('model_aliases', {}).items():
                models.append({
                    "id": alias,
                    "provider": "alias",
                    "maps_to": target,
                    "owned_by": "eon-sovereign-router"
                })
            self._send_json({"object": "list", "data": models})
        elif self.path == '/v1/health':
            self._send_json({"status": "ok", "providers": list(config.data['providers'].keys()), "port": PORT})
        else:
            self._send_json({"error": "not_found"}, 404)

    def do_POST(self):
        if self.path not in ('/v1/chat/completions', '/chat/completions'):
            self._send_json({"error": "not_found"}, 404)
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b'{}'
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self._send_json({"error": "invalid_json"}, 400)
            return
        model = req.get('model', 'auto')
        messages = req.get('messages', [])
        max_tokens = req.get('max_tokens', 4096)
        start = time.time()
        result, trace = route_request(model, messages, max_tokens)
        elapsed = time.time() - start
        if result:
            resp = {
                "id": f"chatcmpl-eon-{int(time.time())}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": result.get("choices", []),
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "eon_router": {"tier": "sovereign", "providers_tried": trace, "elapsed_s": round(elapsed, 2)}
            }
            self._send_json(resp)
        else:
            self._send_json({
                "error": "all_providers_failed",
                "eon_router": {"tier": "sovereign", "providers_tried": trace, "elapsed_s": round(elapsed, 2)}
            }, 502)

class ThreadedServer:
    def __init__(self, host='127.0.0.1', port=PORT):
        self.server = http.server.HTTPServer((host, port), RouterHandler)
        self.server.timeout = 0.5
        self.running = False
        log.info(f"EON Sovereign Router listening on {host}:{port}")

    def serve(self):
        self.running = True
        while self.running:
            self.server.handle_request()

    def stop(self):
        self.running = False

def main():
    import signal
    server = ThreadedServer(host='127.0.0.1', port=PORT)
    def handler(sig, frame):
        log.info("Shutting down...")
        server.stop()
        sys.exit(0)
    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)
    log.info(f"Routes loaded: {len(config.data['providers'])} providers, {sum(len(p.get('models',{})) for p in config.data['providers'].values())} models")
    log.info(f"Config: {CONFIG_FILE}")
    log.info(f"API key status:")
    for pname in config.data['providers']:
        key = resolve_api_key(pname)
        status = "SET" if key else "NOT SET (will be skipped at runtime)"
        log.info(f"  {pname}: {status}")
    server_thread = threading.Thread(target=server.serve, daemon=True)
    server_thread.start()
    server_thread.join()

if __name__ == '__main__':
    main()
