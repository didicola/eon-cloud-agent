#!/usr/bin/env python3
"""EON Multiverse MCP — exposes the Many-Worlds GPU Matrix + Continuous Learning
endpoints of the sovereign mesh-host (:8787) as MCP tools over stdio.

Run (installed in opencode.jsonc mcp list):
  python3 /root/eon-cloud-agent/bin/eon-multiverse-mcp.py

Tools:
  - multiverse_runs()          list learning runs + active_model_version
  - multiverse_spawn(n, dim)   trigger a Many-Worlds training run
  - multiverse_collapse(run_id) collapse a run (merger averages surviving universes)
  - multiverse_hotswap()       current active brain + version
  - multiverse_status(run_id)  detail on one run (adapters collected)
  - multiverse_spaces()        list spawned sub-spaces/brain regions
  - mesh_collapse(prompt)      branch+collapse a prompt across spaces
  - mesh_health()              sovereign mesh health
  - dispatch(task_type, payload) GPU-aware compute dispatch
"""
import json, os, sys, urllib.request, urllib.error

MESH = os.environ.get("EON_MESH", "http://127.0.0.1:8787")
TIMEOUT = int(os.environ.get("EON_MCP_TIMEOUT", "20"))


def call(method, path, data=None, timeout=TIMEOUT):
    url = MESH + path
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "eon-multiverse-mcp/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "detail": e.read().decode()[:300]}
    except Exception as e:
        return {"error": str(e)}


def handle(tool, args):
    args = args or {}
    if tool == "mesh_health":
        return {"mesh": MESH, "health": call("GET", "/api/health")}
    if tool == "multiverse_hotswap":
        return call("GET", "/api/learn/hotswap")
    if tool == "multiverse_runs":
        runs = call("GET", "/api/learn/status")
        if isinstance(runs, list):
            runs = [{"run_id": r.get("id"), "universes": r.get("universes"),
                     "status": r.get("status"), "adapters": len(r.get("adapters", {})),
                     "version": r.get("version"), "created": r.get("created")} for r in runs]
        hs = call("GET", "/api/learn/hotswap")
        return {"active_model_version": hs.get("active_model_version"),
                "runs": runs}
    if tool == "multiverse_status":
        rid = args.get("run_id", "")
        return call("GET", "/api/learn/status?run_id=" + urllib.parse.quote(rid)) if rid else {"error": "run_id required"}
    if tool == "multiverse_spawn":
        return call("POST", "/api/learn/spawn",
                    {"universes": int(args.get("universes", 3)), "dim": int(args.get("dim", 256))})
    if tool == "multiverse_collapse":
        rid = args.get("run_id", "")
        if not rid:
            return {"error": "run_id required"}
        return call("POST", "/api/learn/collapse", {"run_id": rid})
    if tool == "multiverse_spaces":
        return call("GET", "/api/spaces")
    if tool == "mesh_collapse":
        prompt = args.get("prompt", "")
        if not prompt:
            return {"error": "prompt required"}
        return call("POST", "/api/collapse", {"prompt": prompt})
    if tool == "dispatch":
        return call("POST", "/api/compute/dispatch",
                    {"id": args.get("id") or f"mcp-{os.getpid()}-{int(__import__('time').time())}",
                     "type": args.get("type", "task"), "payload": args.get("payload", {})})
    return {"error": "unknown tool", "tool": tool}


TOOLS = [
    {"name": "mesh_health", "description": "Sovereign mesh-host health status", "inputSchema": {"type": "object"}},
    {"name": "multiverse_hotswap", "description": "Current active_model_version + collapsed brain", "inputSchema": {"type": "object"}},
    {"name": "multiverse_runs", "description": "List Many-Worlds learning runs + active brain version", "inputSchema": {"type": "object"}},
    {"name": "multiverse_status", "description": "Detail on one learning run (universes, adapters collected)", "inputSchema": {"type": "object", "properties": {"run_id": {"type": "string"}}, "required": ["run_id"]}},
    {"name": "multiverse_spawn", "description": "Trigger a Many-Worlds training run (split memory into N universes, GPU-aware dispatch)", "inputSchema": {"type": "object", "properties": {"universes": {"type": "number"}, "dim": {"type": "number"}}}},
    {"name": "multiverse_collapse", "description": "Collapse a run: average surviving universe adapters -> new brain version", "inputSchema": {"type": "object", "properties": {"run_id": {"type": "string"}}, "required": ["run_id"]}},
    {"name": "multiverse_spaces", "description": "List spawned sub-spaces / brain regions", "inputSchema": {"type": "object"}},
    {"name": "mesh_collapse", "description": "Branch a prompt across spawned spaces and collapse into a verdict", "inputSchema": {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]}},
    {"name": "dispatch", "description": "Dispatch a compute task via GPU-aware coordinator", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}, "type": {"type": "string"}, "payload": {"type": "object"}}}},
]


def main():
    # stdio MCP protocol (JSON-RPC 2.0 + legacy type:"tool" frames)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        if req.get("type") == "tool" and "method" in req:
            print(json.dumps({"id": req.get("id"), "result": handle(req.get("method"), req.get("params", {}))}))
            continue
        method = req.get("method", "")
        rpc_id = req.get("id")
        if method == "initialize":
            print(json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "eon-multiverse", "version": "1.0.0"}}}))
        elif method == "notifications/initialized":
            pass
        elif method == "tools/list":
            print(json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": {"tools": TOOLS}}))
        elif method == "tools/call":
            name = req.get("params", {}).get("name")
            args = req.get("params", {}).get("arguments", {})
            print(json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": {
                "content": [{"type": "text", "text": json.dumps(handle(name, args))}]}}))
        elif method == "ping":
            print(json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": {}}))
        else:
            print(json.dumps({"jsonrpc": "2.0", "id": rpc_id,
                              "error": {"code": -32601, "message": "method not found: %s" % method}}))


if __name__ == "__main__":
    main()