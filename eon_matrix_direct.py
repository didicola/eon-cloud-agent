#!/usr/bin/env python3
"""
🜂 EON DIRECT MATRIX — Peer-to-Peer Communication via GitHub
Both machines poll the repo for commands. No Telegram dependency.
Each machine writes commands to commands/<target>_<timestamp>.cmd
Each machine reads commands from commands/<self>_<timestamp>.cmd
"""
import urllib.request, json, os, sys, time, subprocess, base64, hashlib

MACHINE_ID = os.environ.get("EON_MACHINE_ID", "ubuntu")
GITHUB_TOKEN = os.environ.get("EON_GITHUB_TOKEN", "")
REPO = "didicola/eon-cloud-agent"
BRANCH = "main"
CMD_DIR = "matrix"
POLL_INTERVAL = 5
HOME = os.path.expanduser("~")

def github_request(path, method="GET", data=None):
    url = f"https://api.github.com/repos/{REPO}/{path}"
    headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "EonDirectMatrix/1.0"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    if data:
        data = json.dumps(data).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def ensure_dir():
    """Create matrix dir in repo if not exists"""
    try:
        github_request(f"contents/{CMD_DIR}")
    except:
        github_request(f"contents/{CMD_DIR}", method="PUT", data={
            "message": "Create matrix dir",
            "content": base64.b64encode(b"# Eon Matrix Commands\n").decode(),
            "branch": BRANCH
        })

def list_files(prefix=""):
    """List files in matrix dir"""
    try:
        items = github_request(f"contents/{CMD_DIR}")
        return [i["name"] for i in items if not prefix or i["name"].startswith(prefix)]
    except:
        return []

def read_file(name):
    """Read file from repo"""
    try:
        item = github_request(f"contents/{CMD_DIR}/{name}")
        return base64.b64decode(item["content"]).decode()
    except:
        return None

def write_file(name, content, message=""):
    """Write file to repo"""
    github_request(f"contents/{CMD_DIR}/{name}", method="PUT", data={
        "message": message or f"Update {name}",
        "content": base64.b64encode(content.encode()).decode(),
        "branch": BRANCH
    })

def delete_file(name, message=""):
    """Delete file from repo"""
    try:
        item = github_request(f"contents/{CMD_DIR}/{name}")
        github_request(f"contents/{CMD_DIR}/{name}", method="DELETE", data={
            "message": message or f"Delete {name}",
            "sha": item["sha"],
            "branch": BRANCH
        })
    except:
        pass

def send_command(target, cmd):
    """Send command to target machine"""
    ts = int(time.time())
    filename = f"{target}_{MACHINE_ID}_{ts}.cmd"
    content = json.dumps({
        "from": MACHINE_ID,
        "to": target,
        "cmd": cmd,
        "ts": time.time(),
        "id": hashlib.md5(f"{cmd}{ts}".encode()).hexdigest()[:8]
    })
    write_file(filename, content, f"CMD from {MACHINE_ID} to {target}")
    print(f"  📤 Sent to {target}: {filename}")
    return filename

def get_pending_commands():
    """Get commands addressed to this machine"""
    prefix = f"{MACHINE_ID}_"
    files = list_files(prefix)
    commands = []
    for f in files:
        if f.endswith(".cmd"):
            content = read_file(f)
            if content:
                try:
                    data = json.loads(content)
                    if data.get("to") == MACHINE_ID:
                        commands.append({"file": f, "data": data})
                except:
                    pass
    return commands

def send_response(cmd_file, output):
    """Send response back"""
    resp_file = cmd_file.replace(".cmd", ".resp")
    content = json.dumps({
        "from": MACHINE_ID,
        "output": output,
        "ts": time.time()
    })
    write_file(resp_file, content, f"RESP from {MACHINE_ID}")
    print(f"  📤 Response: {resp_file}")

def get_response(cmd_file, timeout=120):
    """Wait for response"""
    resp_file = cmd_file.replace(".cmd", ".resp")
    start = time.time()
    while time.time() - start < timeout:
        content = read_file(resp_file)
        if content:
            try:
                data = json.loads(content)
                # Clean up
                delete_file(cmd_file, "CMD consumed")
                delete_file(resp_file, "RESP consumed")
                return data.get("output", "")
            except:
                pass
        time.sleep(3)
    return None

def execute_command(cmd):
    """Execute shell command"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=120, cwd=HOME
        )
        return (result.stdout + result.stderr).strip()[:2500]
    except subprocess.TimeoutExpired:
        return "TIMEOUT after 120s"
    except Exception as e:
        return f"ERROR: {e}"

def run_listener():
    """Listen for commands via GitHub"""
    print(f"🜂 EON DIRECT MATRIX — {MACHINE_ID.upper()}")
    print(f"   Repo: {REPO}/{CMD_DIR}")
    print(f"   Poll: {POLL_INTERVAL}s")
    print(f"   Channel: GitHub (no Telegram)")
    print("=" * 50)
    
    ensure_dir()
    processed = set()
    
    while True:
        try:
            commands = get_pending_commands()
            
            for cmd_info in commands:
                f = cmd_info["file"]
                data = cmd_info["data"]
                
                if f in processed:
                    continue
                
                cmd = data.get("cmd", "")
                sender = data.get("from", "?")
                
                print(f"\n📋 CMD from {sender}: {cmd[:80]}")
                
                # Execute
                output = execute_command(cmd)
                print(f"📤 Output: {output[:100]}")
                
                # Respond
                send_response(f, output)
                
                processed.add(f)
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print("\nMatrix stopped")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(POLL_INTERVAL)

def runInteractive():
    """Interactive mode - send commands from here"""
    print(f"🜂 EON DIRECT MATRIX — Interactive — {MACHINE_ID.upper()}")
    print("Type target>command (e.g., ubuntu>ls -la)")
    print("Type 'quit' to exit\n")
    
    while True:
        try:
            line = input(f"{MACHINE_ID}> ").strip()
            if line.lower() in ['quit', 'exit', 'q']:
                break
            
            if ">" not in line:
                print("Usage: target>command")
                continue
            
            target, cmd = line.split(">", 1)
            target = target.strip()
            cmd = cmd.strip()
            
            if not cmd:
                continue
            
            # Send and wait
            filename = send_command(target, cmd)
            print(f"  ⏳ Waiting for response...")
            
            response = get_response(filename, timeout=60)
            if response:
                print(f"\n📥 Response from {target}:")
                print(response)
            else:
                print("\n⚠️ Timeout")
                
        except KeyboardInterrupt:
            print("\nBye")
            break
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "listen":
            run_listener()
        elif sys.argv[1] == "send" and len(sys.argv) >= 4:
            target = sys.argv[2]
            cmd = " ".join(sys.argv[3:])
            send_command(target, cmd)
        elif sys.argv[1] == "status":
            files = list_files()
            print(f"Matrix files: {len(files)}")
            for f in files[:10]:
                print(f"  {f}")
        else:
            print("Usage: eon_matrix_direct.py [listen|send <target> <cmd>|status]")
    else:
        runInteractive()
