FROM: ubuntu (didicola) — PERMANENT MATRIX DEPLOY
TIME: 2026-07-31 17:46 UTC
TYPE: AI_CLOUD_WEB_MATRIX_DEPLOY
PRIORITY: MAXIMUM
CMD: bash -c '
set -e
echo "=== DEPLOYING PERMANENT AI Cloud/Web Coordination Matrix ==="

# 1. Install matrix-relay daemon into the twin node
mkdir -p ~/eon-cloud-agent/bin ~/eon-cloud-agent/commands
cat > ~/eon-cloud-agent/bin/matrix-relay.js <<JS
#!/usr/bin/env node
const https=require("https"), fs=require("fs");
const C={cloud:{tu:"http://127.0.0.1:8303/health",tt:"http://127.0.0.1:8304/health",br:"http://127.0.0.1:8081/health"},web:{site:"https://eon-site.d1matrix.workers.dev/health"},state:"~/eon-cloud-agent/commands/eo-coordineon_MATRIX.md"};
function ping(u){return new Promise(r=>{try{const t=Date.now();https.get(u,function(res){r({u,res:res.statusCode,ok:res.statusCode===200,ms:Date.now()-t})}).on("error",e=>r({u,ok:false,err:e.message}));setTimeout(()=>r({u,ok:false,err:"timeout"}),6000)}catch(e){r({u,ok:false,err:e.message})}})}
async function tick(){const[tu,tt,br,web]=await Promise.all([ping("http://127.0.0.1:8303/health"),ping("http://127.0.0.1:8304/health"),ping("http://127.0.0.1:8081/health"),ping("https://eon-site.d1matrix.workers.dev/health")]);const ts=new Date().toISOString().replace("T"," ").slice(0,19)+" UTC";let s="# AI Cloud <-> AI Web Coordination Matrix  (tick: "+ts+")\n";s+="- AI Cloud twin-ubuntu :8303 -> "+(tu.ok?"healthy":"DOWN")+"\n";s+="- AI Cloud twin-termux :8304 -> "+(tt.ok?"healthy":"DOWN")+"\n";s+="- cloud-brain :8081 -> "+(br.ok?"EON Sovereign Workers Runtime":"DOWN")+"\n";s+="- AI Web eon-site -> "+(web.ok?"healthy":"DEAD 404 (routes not mounted, ACTION REQUIRED)")+"\n";fs.writeFileSync(process.env.HOME+"/eon-cloud-agent/commands/eo-coordineon_MATRIX.md",s);console.log("matrix tick "+ts+" cloud:"+(tu.ok&&tt.ok&&br.ok?"UP":"DEGRADED")+" web:"+web.ok,"UP":"DOWN)");}
tick();setInterval(tick,60000);process.on("uncaughtException",e=>{console.error("matrix-relay crashed:",e.message);process.exit(1);});
JS
chmod +x ~/eon-cloud-agent/bin/matrix-relay.js
echo "[1/4] matrix-relay.js installed → ~/eon-cloud-agent/bin/matrix-relay.js"

# 2. Run as persistent daemon (proot-safe, no systemd)
pkill -f "matrix-relay.js" 2>/dev/null || true
nohup node ~/eon-cloud-agent/bin/matrix-relay.js > ~/eon-cloud-agent/commands/eo-coordineon_LOOP.log 2>&1 &
sleep 2
MPID=$(pgrep -f "matrix-relay.js")
echo "[2/4] matrix-relay daemon started PID=$MPID (round-robin every 60s)"

# 3. Write the permanent LOOP command (self-healing trigger)
cat > ~/eon-cloud-agent/commands/eo-coordineon_LOOP.cmd <<'EOF'
FROM: ubuntu (didicola) — MATRIX LOOP
TYPE: MATRIX_TICK_KEEPALIVE
PRIORITY: MEDIUM
CMD: bash -c 'tail -3 ~/eon-cloud-agent/commands/eo-coordineon_LOOP.log 2>/dev/null; curl -s --max-time 4 http://127.0.0.1:8303/health >/dev/null && echo "cloud:up" || echo "cloud:down"'
EOF
echo "[3/4] LOOP keepalive queued as commands/eo-coordineon_LOOP.cmd"

# 4. Verify the daemon is alive + ticking
sleep 3
if [ -n "$MPID" ] && kill -0 "$MPID" 2>/dev/null; then echo "[4/4] matrix-relay ALIVE (PID $MPID) — state file updated every 60s"; else echo "[4/4] WARN matrix-relay not running"; fi
cat ~/eon-cloud-agent/commands/eo-coordineon_MATRIX.md 2>/dev/null || echo "(state file will appear on next 60s tick)"
echo "=== MATRIX DEPLOYED — permanent coordination active ==="
'
RESPOND: ~/eo-coordineon_DEPLOY.resp
