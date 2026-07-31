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

def ping_https(url, timeout=8):
    try:
        r=subprocess.run(["curl","-s","--socks5-hostname","127.0.0.1:9050","--max-time",str(timeout),
                          "-o","/dev/null","-w","%{http_code}",url],capture_output=True,text=True,timeout=timeout+2)
        code=int((r.stdout or "0").strip() or "0")
        return {"target":url,"status":"up" if 200<=code<400 else "down","code":code}
    except Exception as e:
        return {"target":url,"status":"down","err":str(e)[:80]}

def handle(tool, args):
    if tool=="get_matrix_status": return read_matrix()
    if tool=="ping_cloud_web": return {"surfaces":[ping("127.0.0.1",p) for p in (8303,8304,8081)]}
    if tool=="ping_ai_web": return {"surfaces":[
        ping_https("https://eon-site.exportdefaultasyncfetchrequestenvconsturl.workers.dev/api/health"),
        ping_https("https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev/health")]}
    if tool=="get_deploy_manifest": return {"commands":list_deploy()}
    return {"error":"unknown tool", "tool":tool}

def main():
    if len(sys.argv)>1 and sys.argv[1]=="serve":
        port = int(os.environ.get("EON_MCP_PORT","8095"))
        from http.server import BaseHTTPRequestHandler, HTTPServer
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.strip("/").split("?")[0]== "mcp":
                    r=json.dumps({"tools":["get_matrix_status","ping_cloud_web","ping_ai_web","get_deploy_manifest"]})
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
