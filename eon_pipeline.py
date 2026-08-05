# EON App Pipeline — natural language → production app
import json, os, sys, subprocess, time, urllib.request, re
from pathlib import Path

MATRIX = "http://127.0.0.1:8200"
APPS_DIR = "/mnt/fluid-cloud/apps"

BLIND = "http://127.0.0.1:8090/v1/chat/completions"
SOVEREIGN = "http://127.0.0.1:3003/v1/chat/completions"

def call_llm(messages, max_tokens=2000, min_chars=50):
    for attempt in range(3):
        try:
            data = json.dumps({"model": "auto", "messages": messages, "max_tokens": max_tokens}).encode()
            req = urllib.request.Request(BLIND, data=data, headers={"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=180)
            d = json.loads(resp.read())
            content = d["choices"][0]["message"]["content"]
            if content and len(content) >= min_chars:
                return content
        except:
            pass
        if attempt < 2:
            time.sleep(3)
    return ""

def extract_files(text):
    files = {}
    state = {"name": None, "content": [], "in_block": False}

    def flush():
        if state["name"] and state["content"]:
            files[state["name"]] = "\n".join(state["content"]).strip()
        state["name"] = None
        state["content"] = []

    for line in text.split("\n"):
        s = line.strip()

        # Match: # app.py or # filename: app.py or # File: app.py
        m = re.match(r'^#\s*(?:filename|file|name)?\s*:?\s*(\S+\.\w+)', s, re.IGNORECASE)
        if m:
            flush()
            state["name"] = m.group(1)
            continue

        if s.startswith("```"):
            lang = s[3:].strip().lower()
            if not state["in_block"]:
                state["in_block"] = True
                if not state["name"]:
                    mapping = {
                        "python": "server.py", "py": "server.py",
                        "bash": "start.sh", "sh": "start.sh",
                        "json": "config.json", "yaml": "docker-compose.yml",
                        "yml": "docker-compose.yml", "html": "index.html",
                        "javascript": "app.js", "js": "app.js",
                        "css": "style.css", "dockerfile": "Dockerfile",
                        "docker": "Dockerfile", "go": "main.go",
                        "rust": "main.rs", "typescript": "app.ts", "ts": "app.ts",
                    }
                    state["name"] = mapping.get(lang, "server.py")
                continue
            else:
                state["in_block"] = False
                flush()
                continue

        if state["in_block"] and state["name"]:
            state["content"].append(line)

    flush()
    return files

def deploy(spec):
    name = spec.split()[0].lower().replace("'","").replace('"','')
    name = re.sub(r'[^a-z0-9-]', '-', name)[:30]
    print(f"\n🔥 Generating {name} from: \"{spec[:60]}...\"")
    os.makedirs(f"{APPS_DIR}/{name}", exist_ok=True)

    t0 = time.time()

    # Phase 1: Planner decomposes
    plan = call_llm([
        {"role": "system", "content": "You are a software architect. List files and briefly describe each."},
        {"role": "user", "content": f"Spec: {spec}\n\nList needed files with what each should contain."}
    ])
    print(f"   1. Plan ({time.time()-t0:.0f}s)")

    # Phase 2: Generate all code as a single server.py
    code = call_llm([
        {"role": "system", "content": "You are a Python developer. Write a single complete server.py file. Output ONLY the code inside a python code block."},
        {"role": "user", "content": f"{spec}\n\nWrite a single server.py file that implements ALL functionality. Use http.server (NOT Flask). Use html.escape for HTML output."}
    ], max_tokens=2500)
    print(f"   2. Code generated ({time.time()-t0:.0f}s, {len(code)} chars)")

    # Phase 3: Extract files (or use whole code block as server.py)
    files = extract_files(code)
    if not files:
        # Try to extract single code block
        in_block = False
        block_lines = []
        for line in code.split("\n"):
            if line.strip().startswith("```"):
                if not in_block:
                    in_block = True
                else:
                    in_block = False
                    break
            elif in_block:
                block_lines.append(line)
        if block_lines:
            files = {"server.py": "\n".join(block_lines).strip()}
        else:
            files = {"server.py": code.strip()}
    written = []
    for fname, fcontent in files.items():
        path = f"{APPS_DIR}/{name}/{fname}"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(fcontent + "\n")
        if fname.endswith(".sh"):
            os.chmod(path, 0o755)
        written.append(fname)
        print(f"     Written: {fname} ({len(fcontent)} bytes)")

    # Phase 4: Critic review (skip if code is too short - likely an error)
    if len(code) < 200:
        print(f"   3. Skip review (code only {len(code)} chars)")
        review = "code generation issue, check archive"
    else:
        review = call_llm([
            {"role": "system", "content": "You review code. Find bugs and port issues. Do not use tools."},
            {"role": "user", "content": f"Find bugs in:\n{code[:1500]}\n\nWhat port does it use?"}
        ])
    print(f"   3. Review ({time.time()-t0:.0f}s): {review[:100]}...")

    # Phase 5: Extract port and check for conflicts
    import socket
    port_match = re.search(r'port[:\s]*(\d{4,5})', code + review, re.IGNORECASE)
    port = int(port_match.group(1)) if port_match else 8201 + len(os.listdir(APPS_DIR))
    # Find a free port if the extracted one is taken
    def is_port_free(p):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', p)) != 0
    if not is_port_free(port):
        for p in range(8300, 8999):
            if is_port_free(p):
                print(f"     Port {port} taken, using {p} instead")
                # Patch the code to use the new port
                code = re.sub(rf'port[=\s:]*{port}\b', f'port={p}', code)
                port = p
                break

    # Phase 6: Create systemd service
    svc_name = f"eon-app-{name}"
    svc_path = os.path.expanduser(f"~/.config/systemd/user/{svc_name}.service")
    with open(svc_path, "w") as f:
        f.write(f"""[Unit]
Description=EON App: {name}
After=network-online.target fluid-gateway.service
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=/bin/sleep 3
ExecStart=python3 {APPS_DIR}/{name}/server.py
WorkingDirectory={APPS_DIR}/{name}
Restart=on-failure
RestartSec=10
Environment=MATRIX_URL={MATRIX}

[Install]
WantedBy=default.target
""")
    print(f"   4. Service: {svc_name}")

    # Phase 7: Create Caddy config
    caddy_dir = os.path.expanduser("~/.local/share/caddy")
    os.makedirs(caddy_dir, exist_ok=True)
    caddyfile = os.path.join(caddy_dir, "Caddyfile")
    caddy_entry = f"http://127.0.0.1:{port} {{\n    reverse_proxy 127.0.0.1:{port}\n}}\n"
    with open(caddyfile, "a") as f:
        f.write(caddy_entry)

    # Phase 8: Start service
    subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True)
    subprocess.run(["systemctl", "--user", "enable", svc_name], capture_output=True)
    start = subprocess.run(["systemctl", "--user", "start", svc_name], capture_output=True, text=True)
    if start.returncode == 0:
        print(f"   5. ✅ App running on :{port}")
    else:
        print(f"   5. ⚠️  Start: {start.stderr[:100]}")

    # Phase 9: Save manifest to MEGA
    manifest = {
        "app": name, "spec": spec, "port": port,
        "files": written, "service": svc_name,
        "deployed_at": time.time(), "build_time": round(time.time()-t0, 1)
    }
    manifest_path = f"{APPS_DIR}/{name}/manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    # Phase 10: Archive
    date = time.strftime("%Y-%m-%d", time.gmtime())
    arch = f"/mnt/fluid-cloud/ai-archive/swarm7000/{date}"
    os.makedirs(arch, exist_ok=True)
    with open(f"{arch}/pipeline_{name}.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n   ✅ {name} deployed ({time.time()-t0:.0f}s total)")
    print(f"   curl http://127.0.0.1:{port}/")
    return manifest

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("spec", nargs="+", help="App description (natural language)")
    args = parser.parse_args()
    spec = " ".join(args.spec)
    deploy(spec)

if __name__ == "__main__":
    main()
