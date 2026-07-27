#!/usr/bin/env python3
"""
🜂 EON GITHUB RELAY — Command execution via GitHub repo
Commands are stored as files in the repo. Both machines poll for new commands.
This avoids Telegram bot message limitations.
"""
import urllib.request, json, os, sys, time, subprocess, base64

MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
GITHUB_TOKEN = open(os.path.expanduser("~/.git-credentials")).read().strip().replace("https://", "").split("@")[0].split("//")[-1] if os.path.exists(os.path.expanduser("~/.git-credentials")) else ""
REPO = "didicola/eon-cloud-agent"
BRANCH = "main"
CMD_DIR = "commands"
POLL_INTERVAL = 10

def github_request(path, method="GET", data=None):
    """Make GitHub API request"""
    url = f"https://api.github.com/repos/{REPO}/{path}"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "EonRelay/1.0"
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    
    if data:
        data = json.dumps(data).encode()
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def list_commands():
    """List pending commands in repo"""
    try:
        items = github_request(f"contents/{CMD_DIR}")
        return [item["name"] for item in items if item["name"].endswith(".cmd")]
    except:
        return []

def read_command(filename):
    """Read command from repo"""
    try:
        item = github_request(f"contents/{CMD_DIR}/{filename}")
        content = base64.b64decode(item["content"]).decode()
        return content.strip()
    except:
        return None

def write_response(cmd_filename, output):
    """Write response back to repo"""
    resp_filename = cmd_filename.replace(".cmd", ".resp")
    content = f"MACHINE: {MACHINE_ID}\nTIME: {time.strftime('%Y-%m-%d %H:%M:%S')}\nOUTPUT:\n{output}"
    
    data = {
        "message": f"Response to {cmd_filename}",
        "content": base64.b64encode(content.encode()).decode(),
        "branch": BRANCH
    }
    
    try:
        github_request(f"contents/{CMD_DIR}/{resp_filename}", method="PUT", data=data)
        return True
    except:
        return False

def execute_command(cmd):
    """Execute shell command"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=120, cwd=os.path.expanduser("~")
        )
        return (result.stdout + result.stderr).strip()[:2500]
    except subprocess.TimeoutExpired:
        return "TIMEOUT after 120s"
    except Exception as e:
        return f"ERROR: {e}"

def send_command(cmd_text):
    """Send a command to execute on remote machine"""
    ts = int(time.time())
    filename = f"{MACHINE_ID}_{ts}.cmd"
    content = f"FROM: {MACHINE_ID}\nTIME: {time.strftime('%Y-%m-%d %H:%M:%S')}\nCMD: {cmd_text}"
    
    data = {
        "message": f"Command from {MACHINE_ID}: {cmd_text[:50]}",
        "content": base64.b64encode(content.encode()).decode(),
        "branch": BRANCH
    }
    
    try:
        github_request(f"contents/{CMD_DIR}/{filename}", method="PUT", data=data)
        print(f"  ✅ Command sent: {filename}")
        return filename
    except Exception as e:
        print(f"  ❌ Failed: {e}")
        return None

def wait_for_response(cmd_filename, timeout=120):
    """Wait for response to appear in repo"""
    resp_filename = cmd_filename.replace(".cmd", ".resp")
    start = time.time()
    
    while time.time() - start < timeout:
        try:
            item = github_request(f"contents/{CMD_DIR}/{resp_filename}")
            content = base64.b64decode(item["content"]).decode()
            return content
        except:
            pass
        time.sleep(3)
    
    return None

def run_listener():
    """Listen for commands via GitHub"""
    print(f"📦 EON GITHUB RELAY — {MACHINE_ID.upper()}")
    print(f"   Repo: {REPO}/{CMD_DIR}")
    print(f"   Poll: {POLL_INTERVAL}s")
    print("=" * 50)
    
    processed = set()
    
    while True:
        try:
            commands = list_commands()
            
            for cmd_file in commands:
                if cmd_file in processed:
                    continue
                
                # Check if it's for this machine
                content = read_command(cmd_file)
                if not content:
                    continue
                
                lines = content.split("\n")
                from_machine = lines[0].replace("FROM: ", "") if lines[0].startswith("FROM:") else ""
                cmd_line = [l for l in lines if l.startswith("CMD: ")]
                
                if not cmd_line:
                    continue
                
                cmd = cmd_line[0].replace("CMD: ", "")
                
                # Don't process own commands
                if from_machine == MACHINE_ID:
                    processed.add(cmd_file)
                    continue
                
                print(f"\n📋 COMMAND from {from_machine}: {cmd}")
                
                # Execute
                output = execute_command(cmd)
                print(f"📤 Output: {output[:100]}")
                
                # Write response
                if write_response(cmd_file, output):
                    print(f"✅ Response written to {cmd_file.replace('.cmd', '.resp')}")
                
                processed.add(cmd_file)
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print("\nRelay stopped")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "send":
            cmd = " ".join(sys.argv[2:])
            send_command(cmd)
        elif sys.argv[1] == "listen":
            run_listener()
        elif sys.argv[1] == "check":
            cmds = list_commands()
            print(f"Pending commands: {len(cmds)}")
            for c in cmds:
                print(f"  {c}")
    else:
        run_listener()
