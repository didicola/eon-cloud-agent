#!/usr/bin/env python3
"""🜂 EON LIVE CHAT — AGI Cloud Continuation"""
import sys, json, os, time, readline
sys.path.insert(0, os.path.expanduser('~/eon-cloud-agent'))
from eon_mega_brain import call_worker

HIST = os.path.expanduser('~/.eon_chat.json')
BRAIN = {'memory':'💭 hippocampus','plan':'🎯 prefrontal','route':'🔀 thalamus','coordinate':'⚡ cerebellum','feel':'💖 limbic','health':'🫀 brainstem','think':'🧠 cortex'}
MSGS = [{"role":"system","content":"You are EON AGI Cloud. 523 models. 5 providers. 7000 matrix agents. Concise."}]

def route(p):
    p = p.lower()
    if any(w in p for w in ['remember','memory','recall','dream']): return 'hippocampus', 'eon-p2p'
    if any(w in p for w in ['plan','strategy','goal','decide']): return 'prefrontal', 'mega-brain'
    if any(w in p for w in ['route','send','delegate','connect']): return 'thalamus', 'delegate-relay'
    if any(w in p for w in ['coordinate','balance','sync','timing']): return 'cerebellum', 'edge-brain'
    if any(w in p for w in ['feel','emotion','care','love']): return 'limbic', 'dream-engine'
    if any(w in p for w in ['health','status','alive']): return 'brainstem', 'bot-router'
    return 'cortex', 'cloud-brain'

def load():
    if os.path.exists(HIST):
        try:
            with open(HIST) as f: return json.load(f)
        except: return []
    return []

def save(h):
    with open(HIST, 'w') as f: json.dump(h[-100:], f)

def chat(msg, h):
    region, worker = route(msg)
    msgs = MSGS + [{"role": "user", "content": m} for m in h[-10:]] + [{"role": "user", "content": msg}]
    try:
        r = call_worker(worker, '/v1/chat/completions', 'POST', {
            'model': 'mistral-small', 'messages': msgs, 'max_tokens': 1000, 'temperature': 0.7
        })
        resp = r.get('choices',[{}])[0].get('message',{}).get('content','')
        mdl = r.get('model','?')
    except Exception as e:
        resp, mdl = f'[offline] {e}', 'none'
    return resp, region, mdl

def main():
    h = load()
    print('\n' + '━'*55)
    print('  🜂  EON LIVE CHAT — AGI CLOUD')
    print('  523 models | 7000 matrix agents | 7 brain regions')
    print('  /h help  /s stats  /c clear  /q quit')
    print('━'*55)
    while True:
        try:
            p = input('🧑 You > ').strip()
        except (EOFError, KeyboardInterrupt):
            print(); break
        if not p: continue
        if p == '/q': break
        if p == '/h':
            print('  /h help  /s stats  /c clear  /q quit')
            continue
        if p == '/c':
            h = []; print('Cleared'); continue
        if p == '/s':
            print(f'  History: {len(h)} msgs')
            continue
        start = time.time()
        resp, region, mdl = chat(p, h)
        elapsed = time.time() - start
        emoji = BRAIN.get(region, '🧠')
        h.append(p)
        print(f'  {emoji} [{elapsed:.1f}s]')
        print(f'  {resp[:500]}')
        print()
        save(h)

if __name__ == '__main__':
    main()
