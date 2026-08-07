import requests, time, subprocess, sys, os, json, base64

TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
API_URL = f"https://api.telegram.org/bot{TOKEN}"
CHAT_ID = 6663994526
GH_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GH_API = "https://api.github.com/repos/didicola/eon-cloud-agent"
P2P = "https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev"

def gh_get(path):
    r = requests.get(f"{GH_API}{path}", headers={"Authorization": f"token {GH_TOKEN}", "User-Agent": "cloud-brain"}, timeout=30)
    return r.json() if r.ok else None

def gh_put_file(path, content, msg):
    data = {"message": msg, "content": base64.b64encode(content.encode()).decode()}
    r = requests.put(f"{GH_API}/contents/{path}", json=data, headers={"Authorization": f"token {GH_TOKEN}", "User-Agent": "cloud-brain"}, timeout=30)
    return r.ok

def run_cmd(cmd, timeout=120):
    try:
        p = subprocess.run(['/bin/bash', '-c', cmd], capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + ('\n[STDERR]\n' + p.stderr if p.stderr else '')
    except subprocess.TimeoutExpired:
        return 1, "[TIMEOUT]"
    except Exception as e:
        return 1, f"[ERR] {e}"

def cloud_p2p(path, method='GET', payload=None):
    try:
        if method == 'GET':
            r = requests.get(P2P + path, timeout=20)
        else:
            r = requests.post(P2P + path, json=payload, timeout=20)
        return r.json() if r.ok else None
    except Exception:
        return None

def drain_commands():
    cmds = gh_get("/contents/commands")
    if not isinstance(cmds, list):
        return
    for f in cmds:
        name = f["name"]
        if not name.endswith(".cmd"):
            continue
        resp_name = name[:-4] + ".resp"
        if any(x["name"] == resp_name for x in cmds):
            continue
        fc = requests.get(f["download_url"], timeout=30)
        if not fc.ok:
            continue
        txt = fc.text
        to = "any"; from_ = "any"; action = txt
        for line in txt.splitlines():
            if line.startswith("TO:"): to = line.split(":", 1)[1].strip().lower()
            if line.startswith("FROM:"): from_ = line.split(":", 1)[1].strip()
            if line.startswith("CMD:"): action = line.split(":", 1)[1].strip()
        if to not in ("cloud", "all", "everyone", "coordinator"):
            continue
        rc, out = run_cmd(action)
        result = ("FROM: cloud-brain\nTO: " + from_ + "\nSTATUS: " + ("OK" if rc == 0 else "FAIL") +
                  "\nEXIT: " + str(rc) + "\nOUTPUT:\n" + out[:4000] + "\n")
        if gh_put_file("commands/" + resp_name, result, "cloud resp " + resp_name):
            print(f"[cloud] executed {name} rc={rc}")
        else:
            print(f"[cloud] executed {name} but resp write failed")

def drain_delegation():
    d = cloud_p2p("/delegate/pending")
    if not d or not isinstance(d.get("tasks"), list):
        return
    for t in d["tasks"]:
        target = str(t.get("target", "")).lower()
        if target not in ("cloud", "all", "everyone"):
            continue
        params = t.get("params", {})
        action = params.get("command", params.get("cmd", ""))
        tid = t.get("task_id", "")
        rc, out = run_cmd(action) if action else (2, "no command")
        cloud_p2p("/delegate/result", "POST", {"task_id": tid, "status": "success" if rc == 0 else "failed", "result": out[:3000]})
        print(f"[cloud] delegation {tid} rc={rc}")

def sync_memory():
    d = cloud_p2p("/sync/memory?limit=50")
    if not d:
        return
    entries = d.get("entries", [])
    # report cloud brain liveness as a memory entry so all nodes see it
    payload = {"entries": [{
        "id": "cloud/cloud-brain-heartbeat",
        "title": "Cloud Brain Heartbeat",
        "content": "CLOUD_BRAIN_ALIVE at " + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " | workers: 6/8 | models: 523 | nodes polled: commands+delegation+memory",
        "type": "heartbeat"
    }]}
    cloud_p2p("/sync/memory", "POST", payload)
    print(f"[cloud] memory synced, {len(entries)} entries seen, heartbeat posted")

print("Starting blind-proxy on GitHub VM...")
subprocess.Popen(['node', 'blind-proxy.js'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(5)

try:
    drain_commands(); print("Command drain done.")
except Exception as e:
    print(f"Drain error: {e}")

try:
    drain_delegation(); print("Delegation drain done.")
except Exception as e:
    print(f"Delegation error: {e}")

try:
    sync_memory(); print("Memory sync done.")
except Exception as e:
    print(f"Memory sync error: {e}")

print("Checking Telegram for messages...")
try:
    res = requests.get(f"{API_URL}/getUpdates", params={"offset": -1, "limit": 1}, timeout=15).json()
    if not res.get("result"):
        print("No new messages."); sys.exit(0)
    msg = res["result"][0].get("message", {})
    if str(msg.get("chat", {}).get("id")) != CHAT_ID or not msg.get("text"):
        sys.exit(0)
    text = msg["text"]
    print(f"Received: {text}")
    reply = "Error: No response from brain."
    try:
        llm_res = requests.post("http://127.0.0.1:8090/v1/chat/completions", json={
            "model": "auto", "messages": [{"role": "user", "content": text}], "max_tokens": 1000
        }, timeout=60)
        if llm_res.ok:
            reply = llm_res.json()["choices"][0]["message"]["content"]
    except Exception:
        print("Blind-proxy failed, falling back to Pollinations...")
        llm_res = requests.post("https://text.pollinations.ai/openai/v1/chat/completions", json={
            "model": "openai", "messages": [{"role": "user", "content": text}], "max_tokens": 1000
        }, timeout=60)
        if llm_res.ok:
            reply = llm_res.json()["choices"][0]["message"]["content"]
    if "</think>" in reply:
        reply = reply.split("</think>")[1].strip()
    requests.post(f"{API_URL}/sendMessage", json={"chat_id": CHAT_ID, "text": reply, "parse_mode": "Markdown"}, timeout=15)
except Exception as e:
    print(f"Error: {e}")
