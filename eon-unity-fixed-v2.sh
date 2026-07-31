#!/bin/bash
# EON Unity Coordination Script v2.1 (FIXED) — proot & Systemd Compatible
# Fixes:
#  1. EON_CLOUD_API -> full working workers.dev URL (short URL is NXDOMAIN)
#  2. Tor no longer REQUIRED (falls back to direct HTTPS; Tor optional)
#  3. Correct /delegate API (pending + result report) matching eon-p2p-cloud worker
#  4. GitHub relay pull for opencode command pickup

# --- 1. Environment Detection ---
if grep -qa "proot" /proc/self/status 2>/dev/null || [ -d "/data/data/com.termux" ]; then
    NODE_NAME="samsung"
    ENV_TYPE="Termux (proot/Android)"
else
    NODE_NAME="ubuntu"
    ENV_TYPE="Ubuntu/Linux (Systemd)"
fi
echo "[EON-UNITY] Environment detected: $ENV_TYPE"
echo "[EON-UNITY] Node Name: $NODE_NAME"

# --- 2. Configuration ---
EON_CLOUD_API="https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev"
EON_ONION="http://h3g6mgcbzzir7g5zvpm6qllydrnsaladwc7c5tdgbo2tmgcdjnddf6yd.onion"
TOR_SOCKS="127.0.0.1:9050"
USE_TOR=0   # 1 = force Tor, 0 = direct HTTPS (works without Tor)

# --- 3. Optional Tor verification (non-fatal) ---
if [ "$USE_TOR" = "1" ]; then
    echo "[EON-UNITY] Verifying Tor..."
    if curl -s --socks5-hostname $TOR_SOCKS --max-time 5 https://check.torproject.org/api/ip 2>/dev/null | grep -q "IsTor\":true"; then
        echo "[EON-UNITY] Tor active."
        CURL_ARGS="--socks5-hostname $TOR_SOCKS"
    else
        echo "[EON-UNITY] Tor not available; using direct HTTPS."
        CURL_ARGS=""
    fi
else
    echo "[EON-UNITY] Running in direct mode (no Tor required)."
    CURL_ARGS=""
fi

# --- 4. The Coordination Loop ---
echo "[EON-UNITY] 🚀 Starting Coordinator for node: $NODE_NAME"
echo "[EON-UNITY] Cloud: $EON_CLOUD_API"
echo "--------------------------------------------------"

while true; do
    TIMESTAMP=$(date -u "+%Y-%m-%d %H:%M:%S")

    # 1. Send Heartbeat (matches worker /heartbeat endpoint)
    curl -s $CURL_ARGS --max-time 10 -X POST "$EON_CLOUD_API/heartbeat" \
         -H "Content-Type: application/json" \
         -d "{\"node\": \"$NODE_NAME\", \"status\": \"online\", \"timestamp\": \"$TIMESTAMP\"}" > /dev/null 2>&1

    # 2. Check for tasks (worker /delegate/pending returns {tasks:[...]})
    TASKS=$(curl -s $CURL_ARGS --max-time 15 "$EON_CLOUD_API/delegate/pending" 2>/dev/null)
    TASK_COUNT=$(echo "$TASKS" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    tasks=d.get('tasks',[]) if isinstance(d,dict) else d
    mine=[t for t in tasks if t.get('target')=='$NODE_NAME']
    print(len(mine))
except: print('0')
" 2>/dev/null || echo "0")

    # 3. Print Status
    echo "[$TIMESTAMP] Node: $NODE_NAME | Tasks: $TASK_COUNT"

    # 4. Execute + REPORT results (this is the key fix — results must be reported)
    if [ "$TASK_COUNT" -gt "0" ]; then
        echo "[$TIMESTAMP] ⚡ Found $TASK_COUNT tasks! Executing..."
        echo "$TASKS" | python3 -c "
import json, sys, subprocess, urllib.request, os
d=json.load(sys.stdin)
tasks=d.get('tasks',[]) if isinstance(d,dict) else d
api=os.environ.get('EON_CLOUD_API')
for t in tasks:
    if t.get('target')!='$NODE_NAME': continue
    tid=t.get('task_id','')
    params=t.get('params',{})
    cmd=params.get('command','') or ' && '.join(params.get('commands',[]))
    try:
        r=subprocess.run(cmd,shell=True,capture_output=True,text=True,timeout=120)
        result=(r.stdout or r.stderr or '')[-3000:]
        status='done' if r.returncode==0 else 'error'
    except Exception as e:
        result=str(e)[:300]; status='error'
    # Report result back to worker
    try:
        body=json.dumps({'task_id':tid,'status':status,'result':result,'machine':'$NODE_NAME'}).encode()
        req=urllib.request.Request(f'{api}/delegate/result',data=body,headers={'Content-Type':'application/json'})
        urllib.request.urlopen(req,timeout=20)
        print(f'  [{tid}] -> {status} (reported)')
    except Exception as e:
        print(f'  [{tid}] -> {status} (report fail: {e})')
" 2>&1
    fi

    # 5. Periodic GitHub pull (picks up delegation commands for opencode)
    if [ $(( $(date +%s) % 120 )) -lt 30 ]; then
        (cd ~/eon-cloud-agent 2>/dev/null && git pull origin main --rebase > /dev/null 2>&1) || true
    fi

    sleep 30
done