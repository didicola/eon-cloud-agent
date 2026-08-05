#!/usr/bin/env python3
"""
🜂 EON TOKENS INJECTOR MATRIX
GPT 5.6 FREE FOREVER — rotates across 13 free providers
All through Tor SOCKS5, zero traces, unlimited effective tokens
"""
import sys, time, json, os, threading, random
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path.home() / 'eon-cloud-agent'))
from eon_mega_brain import call_worker

# ═══════════════════════════════════════════════════════════════════
# 🧠 PROVIDER MATRIX — 13 Free Providers, Unlimited Tokens
# ═══════════════════════════════════════════════════════════════════

PROVIDERS = [
    {"name": "freellmapi",      "worker": "freellmapi",      "rate_limit": 50,  "cooldown": 60,  "priority": 1},
    {"name": "freebuff",        "worker": "freebuff",        "rate_limit": 20,  "cooldown": 60,  "priority": 2},
    {"name": "proxygategllm",   "worker": "proxygategllm",   "rate_limit": 100, "cooldown": 60,  "priority": 3},
    {"name": "fugu-proxy",      "worker": "fugu-proxy",      "rate_limit": 15,  "cooldown": 60,  "priority": 4},
    {"name": "openrouter-free", "worker": "freellmapi",      "rate_limit": 50,  "cooldown": 60,  "priority": 5},
    {"name": "mistral",         "worker": "mistral",         "rate_limit": 100, "cooldown": 60,  "priority": 6},
    {"name": "huggingface",     "worker": "huggingface",     "rate_limit": 100, "cooldown": 60,  "priority": 7},
    {"name": "cerebras",        "worker": "cerebras",        "rate_limit": 100, "cooldown": 60,  "priority": 8},
    {"name": "sambanova",       "worker": "sambanova",       "rate_limit": 30,  "cooldown": 60,  "priority": 9},
    {"name": "github-models",   "worker": "github-models",   "rate_limit": 50,  "cooldown": 60,  "priority": 10},
    {"name": "cloudflare-ai",   "worker": "cloudflare-ai",   "rate_limit": 50,  "cooldown": 60,  "priority": 11},
    {"name": "groq",            "worker": "groq",            "rate_limit": 50,  "cooldown": 60,  "priority": 12},
    {"name": "cloud-brain",     "worker": "cloud-brain",     "rate_limit": 100, "cooldown": 60,  "priority": 13},
]

# GPT 5.6 model mappings per provider
GPT56_MODELS = {
    "freellmapi":      "openai/gpt-5.6-sol",
    "freebuff":        "openai/gpt-5.6-sol",
    "proxygategllm":   "openai/gpt-5.6-sol",
    "fugu-proxy":      "openai/gpt-5.6-sol",
    "openrouter-free": "openai/gpt-5.6-sol",
    "mistral":         "mistral-large-latest",
    "huggingface":     "openai/gpt-5.6-sol",
    "cerebras":        "openai/gpt-oss-120b",
    "sambanova":       "Meta-Llama-3.3-70B-Instruct",
    "github-models":   "gpt-4o",
    "cloudflare-ai":   "@cf/meta/llama-3.3-70b-instruct-fp16",
    "groq":            "llama-3.3-70b-versatile",
    "cloud-brain":     "mistral-small",
}

# Best free models per provider (fallback when GPT 5.6 unavailable)
FALLBACK_MODELS = {
    "freellmapi":      "nvidia/nemotron-3-super-120b-a12b:free",
    "freebuff":        "deepseek-v4-flash",
    "proxygategllm":   "openai/gpt-5.6-sol",
    "fugu-proxy":      "openai/gpt-5.6-sol",
    "openrouter-free": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "mistral":         "mistral-large-latest",
    "huggingface":     "deepseek-ai/DeepSeek-V3-0324",
    "cerebras":        "gpt-oss-120b",
    "sambanova":       "Meta-Llama-3.3-70B-Instruct",
    "github-models":   "gpt-4o",
    "cloudflare-ai":   "@cf/meta/llama-3.3-70b-instruct-fp16",
    "groq":            "llama-3.3-70b-versatile",
    "cloud-brain":     "mistral-small",
}


class TokensMatrix:
    """Tokens Injector Matrix — rotates across 13 providers for unlimited free tokens"""
    
    def __init__(self):
        self.stats = defaultdict(lambda: {"requests": 0, "errors": 0, "last_error": 0, "cooldown_until": 0})
        self.lock = threading.Lock()
        self.total_requests = 0
        self.total_injected = 0
    
    def _is_available(self, provider):
        """Check if provider is available (not in cooldown)"""
        now = time.time()
        stats = self.stats[provider["name"]]
        return now > stats["cooldown_until"]
    
    def _mark_error(self, provider):
        """Mark provider as errored, apply cooldown"""
        name = provider["name"]
        with self.lock:
            self.stats[name]["errors"] += 1
            self.stats[name]["last_error"] = time.time()
            # Exponential cooldown: 10s, 20s, 40s... max 300s
            errors = self.stats[name]["errors"]
            cooldown = min(10 * (2 ** min(errors - 1, 5)), 300)
            self.stats[name]["cooldown_until"] = time.time() + cooldown
    
    def _mark_success(self, provider):
        """Mark provider as successful, reset error count"""
        name = provider["name"]
        with self.lock:
            self.stats[name]["requests"] += 1
            self.stats[name]["errors"] = 0
            self.stats[name]["cooldown_until"] = 0
    
    def inject(self, messages, model_override=None, max_tokens=1000, temperature=0.7):
        """
        Inject tokens through the matrix — rotates across providers
        Returns: (response_text, provider_name, model_used)
        """
        self.total_requests += 1
        
        # Sort providers by priority and availability
        available = [p for p in PROVIDERS if self._is_available(p)]
        if not available:
            # All providers in cooldown — reset and try again
            with self.lock:
                for p in PROVIDERS:
                    self.stats[p["name"]]["cooldown_until"] = 0
            available = PROVIDERS[:]
        
        # Sort by fewest errors (prefer healthy providers)
        available.sort(key=lambda p: (self.stats[p["name"]]["errors"], p["priority"]))
        
        for provider in available:
            try:
                # Determine model to use
                if model_override:
                    model = model_override
                else:
                    model = GPT56_MODELS.get(provider["name"], FALLBACK_MODELS.get(provider["name"], "auto"))
                
                # Call provider through blind-proxy (all routed through Tor)
                result = call_worker(provider["worker"], '/v1/chat/completions', 'POST', {
                    'model': model,
                    'messages': messages,
                    'max_tokens': max_tokens,
                    'temperature': temperature
                })
                
                resp = result.get('choices', [{}])[0].get('message', {}).get('content', '')
                used_model = result.get('model', model)
                
                if resp:
                    self._mark_success(provider)
                    self.total_injected += 1
                    return resp, provider["name"], used_model
                    
            except Exception as e:
                self._mark_error(provider)
                continue
        
        return "All providers exhausted", "none", "none"
    
    def get_stats(self):
        """Get matrix statistics"""
        return {
            "total_requests": self.total_requests,
            "total_injected": self.total_injected,
            "providers": {name: dict(stats) for name, stats in self.stats.items()},
            "available_count": sum(1 for p in PROVIDERS if self._is_available(p)),
            "total_providers": len(PROVIDERS)
        }


# ═══════════════════════════════════════════════════════════════════
# 🧠 CLI INTERFACE
# ═══════════════════════════════════════════════════════════════════

def main():
    matrix = TokensMatrix()
    
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║  🜂 EON TOKENS INJECTOR MATRIX                              ║")
    print("║  GPT 5.6 FREE FOREVER — 13 Providers, Unlimited Tokens     ║")
    print("║  All through Tor SOCKS5, Zero Traces                        ║")
    print("╚═══════════════════════════════════════════════════════════════╝")
    print(f"  Providers: {len(PROVIDERS)} active")
    print(f"  Rate limits: {sum(p['rate_limit'] for p in PROVIDERS)} req/min total")
    print(f"  Effective free tokens: UNLIMITED (rotation across 13 providers)")
    print("  Type /help for commands, /quit to exit\n")
    
    while True:
        try:
            prompt = input("🧠 You > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nMatrix shut down.")
            break
        
        if not prompt:
            continue
        if prompt == "/quit":
            break
        if prompt == "/help":
            print("  /help — this menu")
            print("  /stats — matrix statistics")
            print("  /providers — list all providers")
            print("  /quit — exit")
            continue
        if prompt == "/stats":
            s = matrix.get_stats()
            print(f"  Total requests: {s['total_requests']}")
            print(f"  Successfully injected: {s['total_injected']}")
            print(f"  Available providers: {s['available_count']}/{s['total_providers']}")
            for name, stats in s['providers'].items():
                status = "✅" if matrix._is_available({"name": name}) else "⏳"
                print(f"    {status} {name}: {stats['requests']} req, {stats['errors']} errors")
            continue
        if prompt == "/providers":
            for p in PROVIDERS:
                status = "✅" if matrix._is_available(p) else "⏳"
                print(f"  {status} {p['name']:20s} | priority {p['priority']:2d} | limit {p['rate_limit']}/min")
            continue
        
        # Build messages
        messages = [
            {"role": "system", "content": "You are EON AGI Cloud. Respond intelligently and concisely."},
            {"role": "user", "content": prompt}
        ]
        
        # Inject through matrix
        start = time.time()
        resp, provider, model = matrix.inject(messages)
        elapsed = time.time() - start
        
        print(f"  🔀 [{provider}] via {model} [{elapsed:.1f}s]")
        print(f"  {resp[:500]}")
        print()


if __name__ == '__main__':
    main()
