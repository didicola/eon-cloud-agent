#!/usr/bin/env python3
"""
EON Telegram Brain — Live AI Chat Bot
Routes messages through Universal AI Brain v5.0
Fallback between workers, handles errors gracefully
"""
import urllib.request, json, os, sys, time, traceback

sys.path.insert(0, os.path.expanduser("~"))
from eon_mega_brain import call_worker, WORKERS, VERSION, chat

BOT_TOKEN = "8940974811:AAE4faGkCGl-6oFU3YG8h2_oGTIJ_GrBbow"
CHAT_ID = "6663994526"
POLL_TIMEOUT = 30
LAST_UPDATE = 0
MACHINE = 'termux' if 'termux' in os.popen('uname -a').read().lower() else 'ubuntu'

def tg_api(method, data):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    d = json.dumps(data).encode() if data else None
    h = {'Content-Type': 'application/json'}
    req = urllib.request.Request(url, data=d, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'ok': False, 'error': str(e)[:100]}

def send(text):
    tg_api('sendMessage', {'chat_id': CHAT_ID, 'text': text[:4000]})

def send_action(action):
    tg_api('sendChatAction', {'chat_id': CHAT_ID, 'action': action})

def route_robust(prompt):
    """Route with automatic fallback between workers"""
    workers_to_try = [
        ('cloud-brain', 'cloud-brain-proxy/sovereign-cloud'),
        ('eon-p2p', 'mistral-small'),
        ('eon-p2p', 'llama-3.3-70b'),
        ('cloud-brain', 'cloud-brain-proxy/sovereign-cloud'),
    ]
    
    last_error = None
    for worker, model in workers_to_try:
        try:
            r = call_worker(worker, '/v1/chat/completions', 'POST', {
                'model': model,
                'messages': [{'role': 'user', 'content': prompt}],
                'max_tokens': 2000
            })
            if 'choices' in r:
                content = r['choices'][0]['message']['content']
                if content and len(content) > 10:
                    return f"[{worker}/{model}] {content}", worker
            if 'error' in r:
                last_error = r['error']
            if 'raw' in r:
                return f"[{worker}] {r['raw'][:2000]}", worker
        except Exception as e:
            last_error = str(e)[:100]
            continue
    
    return f"[error] All workers failed: {last_error}", None

def handle_message(text):
    if text.startswith('/'):
        cmd = text.lower().split()[0]
        if cmd == '/start':
            return f"🧠 EON Universal AI Brain v{VERSION}\n{MACHINE.upper()} node\n\nSend any message to chat with the AI.\nCommands: /explain <q>, /version, /models, /status, /dream"
        if cmd == '/help':
            return f"EON Telegram Brain v{VERSION}\n\nCommands:\n/explain <question> - full explain chain-of-thought\n/version - system version\n/models - 39 models across 8 workers\n/status - worker health\n/dream - latest dreams\n\nJust type any message to chat!"
        if cmd == '/explain':
            prompt = text[8:].strip()
            if not prompt:
                return "Usage: /explain <question>\nShows full chain-of-thought with routing, timing, model selection"
            r = chat(prompt, 'auto', 2000, explain_mode=True)
            return f"[{r['worker']}/{r['model']}] {r.get('response','')[:3000]}"
        if cmd == '/version':
            return f"EON Universal AI Brain v{VERSION}\nMachine: {MACHINE}\nVersions available: v1, v2, v3"
        if cmd == '/models':
            p2p = call_worker('eon-p2p', '/v1/models')
            cb = ['cloud-brain-proxy/sovereign-cloud']
            p2p_m = [m['id'] for m in p2p.get('data', [])] if 'data' in p2p else []
            return f"Cloud Brain: {len(cb)}\nEON P2P: {len(p2p_m)} models\nDelegate: 2\nTotal: {len(cb)+len(p2p_m)+2}"
        if cmd == '/status':
            results = []
            for name in ['cloud-brain', 'eon-p2p', 'delegate-relay']:
                try:
                    r = call_worker(name, '/health', timeout=5)
                    ok = 'error' not in r
                    results.append(f"{'✅' if ok else '❌'} {name}")
                except:
                    results.append(f"❌ {name}")
            return f"Workers:\n" + "\n".join(results) + f"\n\nVersion: v{VERSION}\nMachine: {MACHINE}"
        if cmd == '/dream':
            r = call_worker('eon-p2p', '/dream/list?limit=5')
            entries = r.get('entries', [])
            if entries:
                return "Latest dreams:\n" + "\n".join([f"  - {e.get('title','?')[:60]}" for e in entries])
            return "No dreams yet"
    
    # Normal message - route with fallback
    send_action('typing')
    response, used_worker = route_robust(text)
    return response

def poll_loop():
    global LAST_UPDATE
    print(f"🧠 EON Telegram Brain v{VERSION} — {MACHINE.upper()}")
    print(f"   Bot: @Ririmobot")
    print(f"   Poll: {POLL_TIMEOUT}s")
    print("=" * 50)
    sys.stdout.flush()
    
    while True:
        try:
            offset = LAST_UPDATE + 1
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates?offset={offset}&timeout={POLL_TIMEOUT}"
            with urllib.request.urlopen(url, timeout=POLL_TIMEOUT+5) as r:
                data = json.loads(r.read())
            
            for u in data.get('result', []):
                LAST_UPDATE = u['update_id']
                msg = u.get('message', {})
                chat_id = msg.get('chat', {}).get('id')
                text = msg.get('text', '')
                
                if chat_id == int(CHAT_ID) and text:
                    print(f"\n📩 {text[:80]}", flush=True)
                    resp = handle_message(text)
                    send(resp)
                    print(f"📤 {resp[:80]}...", flush=True)
        
        except KeyboardInterrupt:
            print("\nBot stopped")
            break
        except Exception as e:
            print(f"⚠️ {e}", flush=True)
            time.sleep(5)

if __name__ == '__main__':
    poll_loop()
