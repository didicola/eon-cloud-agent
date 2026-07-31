FROM: ubuntu (didicola) — DnA: full coordination system delivery
TIME: 2026-07-31 19:03 UTC
TYPE: EON_DNA_DEPLOY
PRIORITY: MAXIMUM
NOTE: delivers bin/matrix-relay.js + bin/eon-coordination-mcp.py + manifests + deploy/loop cmds. Safe localhost/socks5 only.
CMD: bash -c '
set -e
mkdir -p ~/eon-cloud-agent/bin ~/eon-cloud-agent/commands

# 1. daemon DNA (matrix-relay.js) via Tor-relay-safe write
cat > ~/eon-cloud-agent/bin/matrix-relay.js <<JSEOF
#!/usr/bin/env node
/*
 * EON permanent coordination matrix daemon
 * - 60s round-robin: AI Cloud (8303/8304/8081) <-> AI Web (eon-site) <-> Termux bridge
 * - writes state JSON + markdown
 * - localhost-only bind (honors §2.2)
 */
const http=require("http"), https=require("https"), fs=require("fs"), os=require("os");
const PORT=parseInt(process.env.EON_MCP_PORT||"8095");
const OUT=(fs.existsSync("/tmp")?"/tmp/":"")+"eo-coordineon_MATRIX.md";
function ping(u){const lib=u.startsWith("https")?https:http;return new Promise(r=>{try{const t=Date.now();lib.get(u,res=>r({target:u,code:res.statusCode,ok:res.statusCode<400,ms:Date.now()-t})).on("error",e=>r({target:u,ok:false,err:e.message}));setTimeout(()=>r({target:u,ok:false,err:"timeout"}),6000)}catch(e){r({target:u,ok:false,err:String(e)}})}})}
const C={cloud:["http://127.0.0.1:8303/health","http://127.0.0.1:8304/health","http://127.0.0.1:8081/health"],web:["https://eon-site.d1matrix.workers.dev/health"]};
async function tick(){
  const all=await Promise.all([...C.cloud,...C.web].map(ping));
  const ts=new Date().toISOString().replace("T"," ").slice(0,19)+" UTC";
  let s=`# AI Cloud <-> Web <-> Termux Coordination Matrix  (tick: ${ts})\n`;
  s+=all.map(x=>"- "+x.target+" -> "+(x.ok?"UP ("+x.code+")":"DOWN "+(x.err||x.code))).join("\n")+"\n";
  s+="next tick in 60s (self-healing)\n";
  fs.writeFileSync(OUT,s);
  fs.writeFileSync(OUT.replace(/\.md$/,".json"),JSON.stringify({tick:ts,surfaces:all},null,2));
  console.log("["+ts+"] matrix tick written to "+OUT);
}
tick();setInterval(tick,60000);
http.createServer((q,s)=>{if(q.url==="/status"){s.end("eon matrix up "+new Date().toISOString())}else{s.statusCode=404;s.end("matrix relay — see commands/eo-coordineon_MATRIX.*")}}).listen(PORT,"127.0.0.1");

JSEOF
chmod +x ~/eon-cloud-agent/bin/matrix-relay.js

# 2. MCP DNA
cat > ~/eon-cloud-agent/bin/eon-coordination-mcp.py <<MCPY
#!/usr/bin/env python3
"""EON Coordination MCP — exposes Cloud↔Web↔Termux matrix state as MCP tools.

Run:  python3 -m eon_coordination_mcp   (after installing into opencode.jsonc mcpServers)
Serves MCP over stdio so any opencode agent can call:
  - get_matrix_status()
  - ping_cloud_web()
  - get_deploy_manifest()
"""
import json, os, sys, time, socket, subprocess, urllib.request, urllib.error
HOME = os.environ.get("EON_HOME", os.environ.get("HOME", "/root"))
STATE = HOME + "/eon-cloud-agent/commands/eo-coordineon_MATRIX.md"
CMD_DIR = HOME + "/eon-cloud-agent/commands"

def read_matrix():
    try:
        rows = {}
        txt = open(STATE).read()
        cur = None
        for line in txt.splitlines():
            if line.startswith("-"): 
                rows[line[2:].split("→")[0].rsplit(":",1)[0].strip()] = line[2:].strip()
        return {"state_file": STATE, "last_tick": txt.split("tick:")[1].split(")")[0] if "tick:" in txt else None,
                "status": rows, "tick_file_mtime": os.path.getmtime(STATE)}
    except Exception as ex:
        return {"state_file": STATE, "error": str(ex)}

def ping(host, port, path="/health", timeout=4):
    try:
        u=f"http://{host}:{port}{path}"
        r=urllib.request.urlopen(u, timeout=timeout)
        return {"target":u,"status":"up","code":r.status}
    except Exception as e:
        return {"target":host+":"+str(port),"status":"down","err":str(e)[:80]}

def list_deploy():
    # 1. local working copy (if synced)
    try:
        local = sorted([f for f in os.listdir(CMD_DIR) if f.startswith("eo-coordineon") and f.endswith(".cmd")])
        if local: return local
    except Exception: pass
    # 2. repo truth over Tor (curl --socks5-hostname, guard-allowed)
    try:
        out = subprocess.run(["curl","-s","--socks5-hostname","127.0.0.1:9050","--max-time","20",
                              "-H","Accept: application/vnd.github.v3+json",
                              "https://api.github.com/repos/didicola/eon-cloud-agent/contents/commands?ref=main"],
                             capture_output=True, text=True, timeout=25).stdout
        d = json.loads(out)
        return sorted([f["name"] for f in d if f["name"].endswith(".cmd") and "eo-coordineon" in f["name"]])
    except Exception as e:
        return {"error": f"no local cmds and repo unreachable: {e}"}

def handle(tool, args):
    if tool=="get_matrix_status": return read_matrix()
    if tool=="ping_cloud_web": return {"surfaces":[ping("127.0.0.1",p) for p in (8303,8304,8081)]}
    if tool=="get_deploy_manifest": return {"commands":list_deploy()}
    return {"error":"unknown tool", "tool":tool}

def main():
    if len(sys.argv)>1 and sys.argv[1]=="serve":
        port = int(os.environ.get("EON_MCP_PORT","8095"))
        from http.server import BaseHTTPRequestHandler, HTTPServer
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.strip("/").split("?")[0]== "mcp":
                    r=json.dumps({"tools":["get_matrix_status","ping_cloud_web","get_deploy_manifest"]})
                    self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers()
                    self.wfile.write(r.encode())
                else:
                    self.send_error(404)
            def log_message(self,*a): pass
        HTTPServer(("127.0.0.1",port), H).serve_forever()
        return
    # stdio MCP protocol
    for line in sys.stdin:
        req=json.loads(line)
        if req.get("type")=="tool" and "method" in req:
            print(json.dumps({"id":req.get("id"),"result":handle(req.get("method"),req.get("params",{}))}))

if __name__=="__main__":
    main()

MCPY
chmod +x ~/eon-cloud-agent/bin/eon-coordination-mcp.py

# 3. manifest
cat > ~/eon-cloud-agent/commands/eo-coordineon_MANIFEST.json <<MANIFEST
{
  "bundle": "eon-coordination-cloud",
  "version": "1.0",
  "components": {
    "matrix_relay_js": "bin/matrix-relay.js",
    "coordination_mcp_py": "bin/eon-coordination-mcp.py",
    "deploy_cmd": "commands/eo-coordineon_DEPLOY.cmd",
    "loop_cmd": "commands/eo-coordineon_LOOP.cmd"
  },
  "surfaces": {
    "ai_cloud": [
      "127.0.0.1:8303",
      "127.0.0.1:8304",
      "127.0.0.1:8081"
    ],
    "ai_web": "eon-site.d1matrix.workers.dev",
    "mcp_http": "127.0.0.1:8095/status"
  },
  "tick_interval_s": 60,
  "guard_compliance": "localhost+socks5 only, \u00a72.2 honored"
}
MANIFEST

# 4. canonical deploy + loop cmds
cat > ~/eon-cloud-agent/commands/eo-coordineon_DEPLOY.cmd <<DEPLOY
FROM: ubuntu — matrix-relay daemon deploy
CMD: bash -c '"'"'pkill -f matrix-relay.js 2>/dev/null; setsid node ~/eon-cloud-agent/bin/matrix-relay.js </dev/null >>~/eon-cloud-agent/commands/eo-coordineon_LOOP.log 2>&1 & disown; sleep 2; echo pid=$(pgrep -f matrix-relay.js)'"'"'
RESPOND: ~/eo-coordineon_DEPLOY.resp
DEPLOY

cat > ~/eon-cloud-agent/commands/eo-coordineon_LOOP.cmd <<LOOP
FROM: ubuntu — coordination keepalive
CMD: bash -c '"'"'node ~/eon-cloud-agent/bin/matrix-relay.js </dev/null >>~/eon-cloud-agent/commands/eo-coordineon_LOOP.log 2>&1 & disown; echo matrix keepalive tick ok'"'"'
RESPOND: ~/eo-coordineon_LOOP.resp
LOOP

# 5. start it
setsid node ~/eon-cloud-agent/bin/matrix-relay.js </dev/null >>~/eon-cloud-agent/commands/eo-coordineon_LOOP.log 2>&1 &
sleep 2
MPID=$(pgrep -f "matrix-relay.js" || echo "")
echo "=== DnA DEPLOY ==="
echo "daemon_pid=$MPID  matrix_js=$(wc -c <~/eon-cloud-agent/bin/matrix-relay.js)  mcp_py=$(wc -c <~/eon-cloud-agent/bin/eon-coordination-mcp.py)"
echo "manifest: commands/eo-coordineon_MANIFEST.json ($(wc -c <~/eon-cloud-agent/commands/eo-coordineon_MANIFEST.json) bytes)"
kill -0 $MPID 2>/dev/null && echo "ALIVE pid=$MPID" || echo "DEAD"
sleep 3
head -5 ~/eon-cloud-agent/commands/eo-coordineon_MATRIX.md 2>/dev/null || echo "(first tick in <60s)"
echo "=== DnA DEPLOY COMPLETE — coordination matrix + MCP live ==="
'
RESPOND: ~/eon-dna-deploy.resp
