#!/usr/bin/env python3
"""EON-EDGE — Local sovereign edge gateway.

Primary deployment target of the EON Sovereign Cloud (golden rule: the
sovereign edge IS primary; Cloudflare is backup-only mirror).

Serves:
  GET /                      -> 8-organ sovereign dashboard
  GET /api/health            -> {status: ok, organs: {...}}
  GET /api/remote/discover   -> self-discovery document
  GET /api/remote/fetch      -> sovereign fetch of an earthly URL (via own-cloud
                                worker /web-agent, cached in SQLite)
  GET /api/remote/mirror     -> snapshot an earthly resource under a ref
  GET /api/remote/list       -> list mirrored resources

All earthly access goes through the own-cloud worker (Cloudflare edge), so the
earthly server can never trace back to EON. No earthly tokens required.
Stdlib only.
"""
import json
import os
import re
import socket
import ssl
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("EON_EDGE_PORT", "8787"))
HOST = os.environ.get("EON_EDGE_HOST", "127.0.0.1")
CLOUD_BASE = os.environ.get(
    "EON_CLOUD",
    "https://eon-p2p-cloud.exportdefaultasyncfetchrequestenvconsturl.workers.dev",
)
DB_PATH = os.path.expanduser("~/.eon/eon_edge.db")
TRUNCATE = 20000
CACHE_CAP = 100000
MIRROR_CAP = 1000000

# EON-VAULT route handlers (sovereign Shamir vault; importable, no side effects)
try:
    from eon_vault import vault_handle
except Exception:
    vault_handle = None

# EON-MRI route handler + Cosmic Web dashboard fragment (sovereign telemetry)
try:
    from eon_mri import mri_handle, mri_dashboard_section
except Exception:
    mri_handle = None
    mri_dashboard_section = None

# EON-PODS (WASM Mesh Orchestrator) route handler
try:
    from eon_pods import pods_handle
except Exception:
    pods_handle = None

# EON-SYNAPSE (Stigmergic Pheromone Bus) route handler
try:
    from eon_synapse import synapse_handle
except Exception:
    synapse_handle = None

# EON-HIPPOCAMPUS (Complex-Valued Vector Search) route handler
try:
    from eon_hippocampus import hippocampus_handle
except Exception:
    hippocampus_handle = None

# EON-GENESIS (13th organ — morph-anything creator; mounted by follow-up agent)
try:
    from eon_genesis import genesis_handle
except Exception:
    genesis_handle = None


def _db():
    con = sqlite3.connect(DB_PATH, timeout=5)
    con.execute(
        "CREATE TABLE IF NOT EXISTS cache(url TEXT PRIMARY KEY, body TEXT, status INT, fetched_at INT)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS mirrors(ref TEXT PRIMARY KEY, url TEXT, size INT, status INT, fetched_at INT)"
    )
    return con


def _db_conn():
    """Open a fresh connection with the tables ensured. Callers MUST close."""
    return _db()


def _now():
    return int(time.time())


def _cloud_get(path, params=None, timeout=90):
    url = CLOUD_BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "EON-Edge/1.0 sovereign-gateway"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8", "replace")
        return r.status, body


def sovereign_fetch(raw):
    """Fetch an earthly URL through the own-cloud worker /web-agent so the
    earthly server sees only the Cloudflare edge, never EON."""
    payload = json.dumps({"url": raw, "action": "fetch"}).encode("utf-8")
    req = urllib.request.Request(
        CLOUD_BASE + "/web-agent",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "EON-Edge/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.status, r.read().decode("utf-8", "replace")


def organs_status():
    """Probe each organ (local sovereign edge + own cloud). No hardcoded IPs —
    ports come from env EON_EDGE_PORTS JSON or defaults."""
    default_ports = {"EONHub": 8201, "EONModels": 8090, "EON-Torch": 8089, "EON-Edge": 8088}
    try:
        overrides = json.loads(os.environ.get("EON_EDGE_PORTS", "{}"))
    except Exception:
        overrides = {}
    organs = {}
    for name, port in default_ports.items():
        p = int(overrides.get(name, port))
        ok = False
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{p}/", timeout=4) as r:
                ok = 200 <= r.status < 500
        except Exception:
            ok = False
        organs[name] = {"port": p, "status": "UP" if ok else "DOWN"}
    # data organs
    data = {
        "EON-Memory": _count_table("cache") + _count_table("mirrors"),
        "EON-Dream": _count_file(os.path.expanduser("~/eon-cloud-agent/dreams/insights")),
        "EON-Remote": _count_table("mirrors"),
        "EON-Wrangler": _count_kv(),
    }
    for name, n in data.items():
        organs[name] = {"count": n, "status": "UP" if n > 0 else "PARTIAL"}
    return organs


def _probe_port(port, host=None, timeout=1.5):
    """TCP reachability probe for a local sovereign organ port."""
    try:
        with socket.create_connection((host or HOST, int(port)), timeout=timeout):
            return True
    except Exception:
        return False


def _extra_organs():
    """Five new sovereign organ cards (EON-Pods, EON-Vault, EON-Synapse,
    EON-MRI, EON-Hippocampus) for the dashboard grid."""
    pods_dir = os.path.expanduser("~/.eon/pods")
    try:
        pods = len([f for f in os.listdir(pods_dir) if os.path.isfile(os.path.join(pods_dir, f))])
    except Exception:
        pods = 0
    vault_db = os.path.expanduser("~/.eon/eon_vault.db")
    memory_db = os.path.expanduser("~/.eon/eon_memory.db")
    try:
        port_overrides = json.loads(os.environ.get("EON_EDGE_PORTS", "{}"))
    except Exception:
        port_overrides = {}
    synapse_port = int(port_overrides.get("matrix", 8201))
    extra = {
        "EON-Pods": {"count": pods, "status": "UP" if pods > 0 else "PARTIAL"},
        "EON-Vault": {"count": 1 if os.path.isfile(vault_db) else 0,
                      "status": "UP" if os.path.isfile(vault_db) else "PARTIAL"},
        "EON-Synapse": {"port": synapse_port,
                        "status": "UP" if _probe_port(synapse_port) else "DOWN"},
        "EON-MRI": {"port": PORT, "status": "UP"},
        "EON-Hippocampus": {"count": 1 if os.path.isfile(memory_db) else 0,
                            "status": "UP" if os.path.isfile(memory_db) else "PARTIAL"},
    }
    return extra


def _count_table(table):
    try:
        con = _db()
        try:
            return con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        finally:
            con.close()
    except Exception:
        return 0


def _count_file(path):
    try:
        return len([f for f in os.listdir(path) if os.path.isfile(os.path.join(path, f))])
    except Exception:
        return 0


def _count_kv():
    try:
        con = sqlite3.connect(os.path.expanduser("~/.eon/eon_wrangler.db"), timeout=5)
        try:
            return con.execute("SELECT COUNT(*) FROM kv").fetchone()[0]
        finally:
            con.close()
    except Exception:
        return 0


def sovereignty_score():
    try:
        with open(os.path.expanduser("~/.eon/sovereignty.json")) as f:
            return float(json.load(f).get("score", 100.0))
    except Exception:
        return 100.0


def dashboard_html():
    organs = organs_status()
    score = sovereignty_score()
    cards = ""
    for name, info in organs.items():
        st = info.get("status", "DOWN")
        color = {"UP": "#22c55e", "DOWN": "#ef4444", "PARTIAL": "#f59e0b"}.get(st, "#94a3b8")
        detail = info.get("port", info.get("count", ""))
        cards += (
            f'<div style="background:#131a26;border:1px solid #232a3a;border-radius:10px;'
            f'padding:12px;margin:6px;min-width:150px;">'
            f'<div style="font-weight:bold;color:#e2e8f0;">{name}</div>'
            f'<div style="color:{color};font-size:13px;margin-top:4px;">{st}'
            f'<span style="color:#64748b;margin-left:6px;">({detail})</span></div></div>\n'
        )
    for name, info in _extra_organs().items():
        st = info.get("status", "DOWN")
        color = {"UP": "#22c55e", "DOWN": "#ef4444", "PARTIAL": "#f59e0b"}.get(st, "#94a3b8")
        detail = info.get("port", info.get("count", ""))
        cards += (
            f'<div style="background:#131a26;border:1px solid #232a3a;border-radius:10px;'
            f'padding:12px;margin:6px;min-width:150px;">'
            f'<div style="font-weight:bold;color:#e2e8f0;">{name}</div>'
            f'<div style="color:{color};font-size:13px;margin-top:4px;">{st}'
            f'<span style="color:#64748b;margin-left:6px;">({detail})</span></div></div>\n'
        )
    mirrors = _mirror_list()
    mirror_rows = ""
    for m in mirrors[:20]:
        mirror_rows += (
            f'<div style="padding:4px 0;border-bottom:1px solid #1e2633;">'
            f'<code style="color:#22c55e;">{m[0]}</code> '
            f'<span style="color:#64748b;">{m[1]}</span></div>'
        )
    if not mirror_rows:
        mirror_rows = '<div style="color:#64748b;">no earthly resources mirrored yet — sovereign only</div>'
    dream_last = _dream_last()
    return f"""<!DOCTYPE html>
<html><head><title>EON Sovereign Cloud — 8 Organs</title>
<meta http-equiv="refresh" content="60">
<style>body{{background:#0b0e14;color:#cbd5e1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:24px;}}
h1{{color:#22c55e;}} .panel{{background:#111827;border:1px solid #232a3a;border-radius:12px;padding:16px;margin:14px 0;}}
h3{{color:#e2e8f0;margin-top:0;}}</style></head><body>
<h1>EON Sovereign Cloud</h1>
<div class="panel" id="genesis-console">
<h3>Genesis Console <span style="color:#f59e0b;">morph-anything</span></h3>
<div style="color:#94a3b8;margin-bottom:10px;">Morph the farm into any earthly technology on command — $0, sovereign.</div>
<form id="genesis-form" style="display:flex;gap:8px;flex-wrap:wrap;">
<input type="text" id="genesis-request" name="request" placeholder='e.g. "Generate a decentralized chat app"' style="flex:1;min-width:260px;background:#0b0e14;border:1px solid #232a3a;color:#e2e8f0;border-radius:8px;padding:10px;font-family:inherit;" />
<button type="submit" style="background:#22c55e;color:#0b0e14;border:0;border-radius:8px;padding:10px 18px;font-weight:bold;cursor:pointer;font-family:inherit;">Create</button>
</form>
<div style="color:#475569;margin-top:8px;">POST /api/genesis/create&nbsp; {{service_type, name, spec?}}</div>
<div id="genesis-output" style="margin-top:12px;white-space:pre-wrap;color:#22c55e;"></div>
<script>
(function(){{
  var form=document.getElementById('genesis-form');
  var out=document.getElementById('genesis-output');
  form.addEventListener('submit',function(ev){{
    ev.preventDefault();
    var req=(document.getElementById('genesis-request').value||'').trim();
    var low=req.toLowerCase();
    var rules=[
      [['cdn','video'],'video_cdn'],
      [['chat'],'chat_app'],
      [['serverless','lambda','function'],'serverless_functions'],
      [['storage','bucket','object'],'object_storage'],
      [['kv','key','cache'],'key_value_store'],
      [['queue'],'message_queue'],
      [['auth'],'auth_service'],
      [['api'],'api_gateway'],
      [['web','site','host'],'web_host']
    ];
    var st='hello_world_api';
    for(var i=0;i<rules.length;i++){{
      var hit=false;
      for(var j=0;j<rules[i][0].length;j++){{
        var rx=new RegExp('(^|[^a-z0-9])'+rules[i][0][j]+'([^a-z0-9]|$)');
        if(rx.test(low)){{hit=true;break;}}
      }}
      if(hit){{st=rules[i][1];break;}}
    }}
    var words=low.split(/[^a-z0-9]+/).filter(Boolean);
    var name=words.join('-').substring(0,32);
    if(!name){{name='genesis-'+Date.now();}}
    out.textContent='creating ' + name + ' (' + st + ')...';
    fetch('/api/genesis/create',{{
      method:'POST',
      headers:{{'Content-Type':'application/json'}},
      body:JSON.stringify({{service_type:st,name:name}})
    }}).then(function(r){{
      return r.json().catch(function(){{return {{status:r.status}};}});
    }}).then(function(d){{
      var parts=['service_type: '+st,'name: '+name,'port: '+(d.port||'-'),'url: '+(d.url||d.host||'-'),'commit: '+(d.commit||'-'),'status: '+(d.status||'-')];
      out.textContent=parts.join(String.fromCharCode(10));
    }}).catch(function(e){{out.textContent='error: '+e;}});
  }});
}})();
</script>
</div>
<div class="panel"><h3>Organs</h3><div style="display:flex;flex-wrap:wrap;">{cards}</div></div>
<div class="panel"><h3>Remote Access <span style="color:#f59e0b;">earthly mirror</span></h3>{mirror_rows}
<div style="color:#64748b;margin-top:8px;">mirrored earthly resources — fallback only, never primary</div></div>
<div class="panel"><h3>Dream Status</h3>{dream_last}
<div style="color:#64748b;margin-top:8px;">dark_energy.py daemon — daily cycle via eon-dream.timer</div></div>
<div class="panel"><h3>Sovereignty Score</h3>
<div style="font-size:34px;font-weight:bold;color:{'#22c55e' if score >= 80 else '#f59e0b'};">{score:.0f}%</div>
<div style="color:#64748b;">sovereign vs earthly fallback (source: ~/.eon/sovereignty.json)</div></div>
{mri_dashboard_section() if mri_dashboard_section else ''}
<footer style="color:#475569;margin-top:16px;">EON Sovereign Cloud · sovereign edge gateway v1.0 · served by EON-Edge</footer>
</body></html>"""


def _mirror_list():
    try:
        con = _db()
        try:
            return con.execute("SELECT ref, url FROM mirrors ORDER BY fetched_at DESC").fetchall()
        finally:
            con.close()
    except Exception:
        return []


def _dream_last():
    try:
        with open(os.path.expanduser("~/.eon/eon_dream_state.json")) as f:
            d = json.load(f)
            return f'<div>last run: <code>{d.get("last_run","-")}</code> · next: <code>{d.get("next_run","-")}</code> · insights: {d.get("insight_count","-")}</div>'
    except Exception:
        return '<div style="color:#64748b;">pending first run</div>'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, data, status=200, ctype="application/json"):
        body = data if isinstance(data, bytes) else json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            if path == "/" or path == "/dashboard":
                self._send(dashboard_html().encode("utf-8"), 200, "text/html; charset=utf-8")
                return
            if path == "/api/health":
                organs = organs_status()
                up = sum(1 for o in organs.values() if o["status"] == "UP")
                self._send({
                    "status": "ok",
                    "score": sovereignty_score(),
                    "organs_up": up,
                    "organs_total": len(organs),
                    "organs": organs,
                    "timestamp": _now(),
                })
                return
            if path == "/api/mri":
                if not mri_handle:
                    self._send({"ok": False, "error": "EON-MRI unavailable"}, 503)
                    return
                params = {k: v[0] for k, v in qs.items()}
                status, payload = mri_handle(path, params)
                self._send(payload, status)
                return
            if path == "/api/remote/discover":
                endpoints = [
                    {"path": "/api/remote/fetch", "method": "GET", "params": ["url"]},
                    {"path": "/api/remote/mirror", "method": "GET", "params": ["url", "ref"]},
                    {"path": "/api/remote/list", "method": "GET"},
                    {"path": "/api/remote/discover", "method": "GET"},
                    {"path": "/api/mri", "method": "GET"},
                    {"path": "/api/health", "method": "GET"},
                ]
                if vault_handle:
                    endpoints += [
                        {"path": "/api/vault/store", "method": "POST", "params": ["name", "secret"]},
                        {"path": "/api/vault/fetch", "method": "GET", "params": ["name"]},
                        {"path": "/api/vault/share", "method": "GET|POST", "params": ["name", "idx", "share_hex"]},
                        {"path": "/api/vault", "method": "GET"},
                    ]
                if genesis_handle:
                    endpoints += [
                        {"path": "/api/genesis/create", "method": "POST", "params": ["service_type", "name", "spec"]},
                        {"path": "/api/genesis/list", "method": "GET"},
                        {"path": "/api/genesis/route/<name>/<path>", "method": "GET"},
                    ]
                self._send({
                    "ok": True, "organ": "eon-edge", "version": "1.0.0",
                    "host": f"{HOST}:{PORT}", "cloud": CLOUD_BASE,
                    "endpoints": endpoints,
                    "timestamp": _now(),
                })
                return
            if path == "/api/remote/fetch":
                raw = qs.get("url", [""])[0]
                if not raw:
                    self._send({"ok": False, "error": "missing url param"}, 400)
                    return
                if not re.match(r"^https?://", raw):
                    self._send({"ok": False, "error": "unsafe target"}, 400)
                    return
                con = _db()
                try:
                    row = con.execute("SELECT body, status FROM cache WHERE url=?", (raw,)).fetchone()
                    if row:
                        self._send({"ok": True, "status": row[1], "cached": True, "from_cache": True,
                                    "source": "sovereign-edge", "url": raw,
                                    "body": row[0][:TRUNCATE]})
                        return
                    try:
                        st, body = sovereign_fetch(raw)
                        entry = json.loads(body) if body.startswith("{") else {"raw": body}
                        content = json.dumps(entry)
                        con.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?,?)",
                                    (raw, content[:CACHE_CAP], st, _now()))
                        con.commit()
                        self._send({"ok": True, "status": st, "cached": False, "from_cache": False,
                                    "source": "sovereign-edge", "url": raw,
                                    "body": content[:TRUNCATE]})
                    except Exception as e:
                        self._send({"ok": False, "error": "fetch failed: " + str(e)}, 502)
                finally:
                    con.close()
                return
            if path == "/api/remote/mirror":
                raw = qs.get("url", [""])[0]
                ref = qs.get("ref", [""])[0]
                if not raw:
                    self._send({"ok": False, "error": "missing url param"}, 400)
                    return
                if not ref:
                    ref = "mirror-" + time.strftime("%Y%m%d%H%M%S")
                try:
                    st, body = sovereign_fetch(raw)
                    size = len(body)
                    con = _db()
                    try:
                        con.execute("INSERT OR REPLACE INTO mirrors VALUES (?,?,?,?,?)",
                                    (ref, raw, size, st, _now()))
                        con.commit()
                    finally:
                        con.close()
                    self._send({"ok": True, "ref": ref, "url": raw, "size": size,
                                "stored": True, "status": st})
                except Exception as e:
                    self._send({"ok": False, "error": "mirror failed: " + str(e)}, 502)
                return
            if path == "/api/remote/list":
                self._send({"ok": True, "count": len(_mirror_list()), "mirrors": _mirror_list(),
                            "storage": "sqlite", "timestamp": _now()})
                return
            if path.startswith("/api/genesis") and genesis_handle:
                params = {k: v[0] for k, v in qs.items()}
                status, payload = genesis_handle(path, params)
                self._send(payload, status)
                return
            if path.startswith("/api/pods") and pods_handle:
                params = {k: v[0] for k, v in qs.items()}
                status, payload = pods_handle(path, params)
                self._send(payload, status)
                return
            if path.startswith("/api/synapse") and synapse_handle:
                params = {k: v[0] for k, v in qs.items()}
                status, payload = synapse_handle(path, params)
                self._send(payload, status)
                return
            if path.startswith("/api/memory") and hippocampus_handle:
                params = {k: v[0] for k, v in qs.items()}
                status, payload = hippocampus_handle(path, params)
                self._send(payload, status)
                return
            if vault_handle and path in ("/api/vault", "/api/vault/fetch", "/api/vault/share"):
                params = {k: v[0] for k, v in qs.items()}
                status, payload = vault_handle(path, params)
                self._send(payload, status)
                return
            self._send({"ok": False, "error": "not found: " + path}, 404)
        except Exception as e:
            self._send({"ok": False, "error": "internal: " + str(e)}, 500)

    def do_POST(self):
        """POST dispatch: EON-VAULT store / peer share push (JSON body)."""
        path = urllib.parse.urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b""
            try:
                params = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                params = {}
            if vault_handle and path in ("/api/vault/store", "/api/vault/share"):
                status, payload = vault_handle(path, params)
                self._send(payload, status)
                return
            if path.startswith("/api/genesis") and genesis_handle:
                params.setdefault("_method", "POST")
                if raw:
                    params.setdefault("_body", raw.decode("utf-8", "replace"))
                status, payload = genesis_handle(path, params)
                self._send(payload, status)
                return
            if path.startswith("/api/pods") and pods_handle:
                status, payload = pods_handle(path, params)
                self._send(payload, status)
                return
            if path.startswith("/api/synapse") and synapse_handle:
                status, payload = synapse_handle(path, params)
                self._send(payload, status)
                return
            self._send({"ok": False, "error": "not found: " + path}, 404)
        except Exception as e:
            self._send({"ok": False, "error": "internal: " + str(e)}, 500)


def _tls_context():
    """Sovereign .eon TLS — EON-CA self-generated wildcard (*.eon) cert from ~/.eon/certs.
    No ICANN, no earthly registrar: the Cloud IS its own CA (EON-CA)."""
    cert = os.path.expanduser("~/.eon/certs/opencode.eon.crt")
    key = os.path.expanduser("~/.eon/certs/opencode.eon.key")
    if not (os.path.isfile(cert) and os.path.isfile(key)):
        return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    return ctx


def main():
    _db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"EON-Edge sovereign gateway on http://{HOST}:{PORT}", flush=True)
    # Sovereign .eon domain over HTTPS: https://dashboard.eon / https://opencode.eon
    tls_port = int(os.environ.get("EON_EDGE_TLS_PORT", "8444"))
    tls_ctx = _tls_context()
    if tls_ctx:
        try:
            tsrv = ThreadingHTTPServer((HOST, tls_port), Handler)
            tsrv.socket = tls_ctx.wrap_socket(tsrv.socket, server_side=True)
            threading.Thread(target=tsrv.serve_forever, daemon=True).start()
            print(f"EON-Edge HTTPS .eon domain on https://{HOST}:{tls_port} (EON-CA)", flush=True)
        except Exception as e:
            print("EON-Edge TLS listener disabled:", e, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
