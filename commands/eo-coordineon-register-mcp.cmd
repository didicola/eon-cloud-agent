FROM: ubuntu (didicola) — MCP REGISTRATION
TIME: 2026-07-31 18:36 UTC
TYPE: MCP_REGISTER
PRIORITY: MAXIMUM
NOTE: adds eon-coordination MCP to THIS opencode config (stdio python3, localhost state)
CMD: bash -c '
set -e
F="$HOME/.config/opencode/opencode.jsonc"
mkdir -p "$HOME/.config/opencode"
cp "$F" "$F.bak.eon-mcp-$(date +%s)" 2>/dev/null || true
# inject mcpServers-style entry under "mcp" block (safe jq-free patch)
python3 - "$F" <<PY
import json,sys
p=sys.argv[1]
t=open(p).read()
try: d=json.loads(t)
except: 
    # strip trailing // lines if present
    d=json.loads("\n".join(l for l in t.splitlines() if not l.strip().startswith("#")))
m=d.get("mcp",{})
m["mcp"]["eon-coordination"]={
  "description":"EON Cloud<->Web<->Termux coordination matrix MCP (matrix-relay.js state + deploy manifests)",
  "enabled":True,"type":"local",
  "command":["python3","/home/ricos/eon-cloud-agent/bin/eon-coordination-mcp.py"]
}
open(p,"w").write(json.dumps(d,indent=2))
print(" registered eon-coordination MCP in",p)
PY
'
RESPOND: ~/mcp-register.resp
