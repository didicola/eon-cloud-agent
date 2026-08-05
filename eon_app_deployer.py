# EON App Deployer — turns swarm outputs into real running services
import json, os, sys, subprocess, time, urllib.request
from pathlib import Path

ARCHIVE = "/mnt/fluid-cloud/ai-archive/swarm7000"
APPS_DIR = "/mnt/fluid-cloud/apps"
MATRIX = "http://127.0.0.1:8200"
SWARM_DB = os.path.expanduser("~/.eon/swarm7000.db")

def get_latest_archive(agent_type, keyword=""):
    date = time.strftime("%Y-%m-%d", time.gmtime())
    d = f"{ARCHIVE}/{date}"
    if not os.path.isdir(d):
        return None
    files = sorted(os.listdir(d), reverse=True)
    for f in files:
        if f.startswith(agent_type) and keyword in f:
            path = os.path.join(d, f)
            with open(path) as fh:
                return json.load(fh)
    return None

def call_matrix(prompt, system="You are a deployment engineer."):
    data = json.dumps({
        "model": "auto",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 1000
    }).encode()
    req = urllib.request.Request(f"{MATRIX}/v1/chat/completions",
        data=data, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        d = json.loads(resp.read())
        return d["choices"][0]["message"]["content"]
    except Exception as e:
        return f"# Error: {e}"

def deploy_app(name, description=""):
    print(f"\n🔥 Deploying: {name}")
    os.makedirs(f"{APPS_DIR}/{name}", exist_ok=True)

    # Step 1: Generate deployment plan via Matrix
    print("   1. Generating deployment plan...")
    plan = call_matrix(
        f"Create deployment plan for '{name}': {description}. "
        f"Output a Python server script (server.py) and a start.sh launcher. "
        f"Server must listen on 127.0.0.1 with a port > 8200. "
        f"Wrap each file in ``` fences with the filename as a comment on the first line.",
        "You are a deployment engineer. Output files wrapped in ``` fences with # filename headers."
    )

    # Step 2: Extract and write files
    print("   2. Writing files...")
    state = {"current_file": None, "current_content": [], "written": [], "in_code": False}

    def flush_file():
        if state["current_file"] and state["current_content"]:
            path = f"{APPS_DIR}/{name}/{state['current_file']}"
            content = "\n".join(state["current_content"]).strip()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(content + "\n")
            os.chmod(path, 0o755 if state["current_file"].endswith(".sh") else 0o644)
            state["written"].append(path)
            print(f"     Written: {path} ({len(content)} bytes)")
        state["current_file"] = None
        state["current_content"] = []

    for line in plan.split("\n"):
        stripped = line.strip()

        # Check for filename header: # filename.ext (inside or outside code blocks)
        if stripped.startswith("# ") and any(
            stripped.endswith(ext) for ext in
            [".py", ".sh", ".json", ".yml", ".yaml", ".txt", ".conf", ".js", ".html", ".css", ".go", ".rs", ".ts"]
        ):
            flush_file()
            state["current_file"] = stripped[2:].strip()
            continue

        if stripped.startswith("```"):
            state["in_code"] = not state["in_code"]
            if not state["in_code"]:
                flush_file()
            continue

        if state["in_code"] and state["current_file"]:
            state["current_content"].append(line)

    flush_file()

    # Step 3: Create systemd service
    print("   3. Creating systemd service...")
    port = 8201 + len(os.listdir(APPS_DIR))
    service_content = f"""[Unit]
Description=EON App: {name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=python3 {APPS_DIR}/{name}/server.py
WorkingDirectory={APPS_DIR}/{name}
Restart=on-failure
RestartSec=5
Environment=MATRIX_URL={MATRIX}

[Install]
WantedBy=default.target
"""
    svc_path = os.path.expanduser(f"~/.config/systemd/user/eon-app-{name}.service")
    with open(svc_path, "w") as f:
        f.write(service_content)
    print(f"     Service: {svc_path}")

    # Step 4: Try to start
    print("   4. Starting service...")
    subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True)
    result = subprocess.run(["systemctl", "--user", "start", f"eon-app-{name}"],
                          capture_output=True, text=True)
    if result.returncode == 0:
        print(f"     ✅ Service started: eon-app-{name}.service")
    else:
        print(f"     ⚠️  Service start failed (may need manual fix): {result.stderr[:100]}")

    # Step 5: Save to MEGA
    manifest = {
        "app": name, "port": port, "files": state["written"],
        "service": f"eon-app-{name}.service",
        "matrix": MATRIX, "deployed_at": time.time()
    }
    manifest_path = f"{APPS_DIR}/{name}/manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"     Manifest: {manifest_path}")

    # Step 6: Archive
    archive_path = f"{ARCHIVE}/{time.strftime('%Y-%m-%d', time.gmtime())}/deploy_{name}.json"
    os.makedirs(os.path.dirname(archive_path), exist_ok=True)
    with open(archive_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n   ✅ {name} deployed!")
    return manifest

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="App name")
    parser.add_argument("--desc", default="", help="App description")
    args = parser.parse_args()

    deploy_app(args.name, args.desc)

if __name__ == "__main__":
    main()
