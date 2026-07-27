#!/usr/bin/env python3
"""
EON GITHUB RELAY — Command execution via GitHub repo
Commands are stored as files in the repo. Both machines poll for new commands.
Uses Tor SOCKS5 proxy for GitHub API access.
"""
import requests, json, os, sys, time, subprocess, base64

MACHINE_ID = os.environ.get("EON_MACHINE_ID", "termux")
GITHUB_TOKEN = ""
try:
    with open(os.path.expanduser("~/.git-credentials")) as f:
        line = f.read().strip()
        if "@" in line:
            GITHUB_TOKEN = line.split("//")[1].split("@")[1].split(":")[1] if ":" in line.split("//")[1].split("@")[0] else ""
            if not GITHUB_TOKEN:
                GITHUB_TOKEN = line.split("//")[1].split("@")[0]
except:
    pass
if not GITHUB_TOKEN:
    GITHUB_TOKEN = "${GITHUB_TOKEN}"

REPO = "didicola/eon-cloud-agent"
BRANCH = "main"
CMD_DIR = "commands"
POLL_INTERVAL = 10

PROXIES = {
    'https': 'socks5h://127.0.0.1:9050',
    'http': 'socks5h://127.0.0.1:9050'
}

HEADERS = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "EonRelay/1.0"
}

def github_request(path, method="GET", data=None):
    url = f"https://api.github.com/repos/{REPO}/{path}"
    h = dict(HEADERS)
    if GITHUB_TOKEN:
        h["Authorization"] = f"token {GITHUB_TOKEN}"
    r = requests.request(method, url, headers=h, json=data, proxies=PROXIES, timeout=30)
    r.raise_for_status()
    return r.json()

def list_commands():
    try:
        items = github_request(f"contents/{CMD_DIR}")
        return [item["name"] for item in items if item["name"].endswith(".cmd")]
    except:
        return []

def read_command(filename):
    try:
        item = github_request(f"contents/{CMD_DIR}/{filename}")
        return base64.b64decode(item["content"]).decode().strip()
    except:
        return None

def write_response(cmd_filename, output):
    resp_filename = cmd_filename.replace(".cmd", ".resp")
    content = f"MACHINE: {MACHINE_ID}\nTIME: {time.strftime('%Y-%m-%d %H:%M:%S')}\nOUTPUT:\n{output}"
    data = {
        "message": f"Response to {cmd_filename} from {MACHINE_ID}",
        "content": base64.b64encode(content.encode()).decode(),
        "branch": BRANCH
    }
    try:
        github_request(f"contents/{CMD_DIR}/{resp_filename}", method="PUT", data=data)
        return True
    except Exception as e:
        print(f"  write_response error: {e}")
        return False

def execute_command(cmd):
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=120, cwd=os.path.expanduser("~")
        )
        return (result.stdout + result.stderr).strip()[:4000]
    except subprocess.TimeoutExpired:
        return "TIMEOUT after 120s"
    except Exception as e:
        return f"ERROR: {e}"

def send_command(cmd_text):
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
        print(f"  Command sent: {filename}")
        return filename
    except Exception as e:
        print(f"  Failed: {e}")
        return None

def wait_for_response(cmd_filename, timeout=120):
    resp_filename = cmd_filename.replace(".cmd", ".resp")
    start = time.time()
    while time.time() - start < timeout:
        try:
            item = github_request(f"contents/{CMD_DIR}/{resp_filename}")
            return base64.b64decode(item["content"]).decode()
        except:
            pass
        time.sleep(3)
    return None

def run_listener():
    print(f"EON GITHUB RELAY — {MACHINE_ID.upper()}")
    print(f"  Repo: {REPO}/{CMD_DIR}")
    print(f"  Poll: {POLL_INTERVAL}s")
    print(f"  Tor: SOCKS5 via 127.0.0.1:9050")
    print("=" * 50)
    sys.stdout.flush()

    processed = set()

    while True:
        try:
            commands = list_commands()
            for cmd_file in commands:
                if cmd_file in processed:
                    continue
                content = read_command(cmd_file)
                if not content:
                    continue
                lines = content.split("\n")
                from_machine = lines[0].replace("FROM: ", "") if lines[0].startswith("FROM:") else ""
                cmd_line = [l for l in lines if l.startswith("CMD: ")]
                if not cmd_line:
                    continue
                cmd = cmd_line[0].replace("CMD: ", "")
                if from_machine == MACHINE_ID:
                    processed.add(cmd_file)
                    continue

                print(f"\nCOMMAND from {from_machine}: {cmd}", flush=True)
                output = execute_command(cmd)
                print(f"Output: {output[:200]}", flush=True)
                write_response(cmd_file, output)
                processed.add(cmd_file)

            time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            print("\nRelay stopped")
            break
        except Exception as e:
            print(f"Error: {e}", flush=True)
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "send":
            send_command(" ".join(sys.argv[2:]))
        elif sys.argv[1] == "listen":
            run_listener()
        elif sys.argv[1] == "check":
            cmds = list_commands()
            print(f"Pending: {len(cmds)}")
            for c in cmds:
                print(f"  {c}")
        elif sys.argv[1] == "test":
            print("Testing GitHub relay...")
            r = github_request("commits?per_page=1")
            print(f"GitHub OK: {r[0]['sha'][:7]}")
            cmds = list_commands()
            print(f"Pending commands: {len(cmds)}")
    else:
        run_listener()
