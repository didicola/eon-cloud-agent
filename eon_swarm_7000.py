# EON 7000 Agent Swarm — scalable worker pool with MEGA-backed coordination
import json, os, sys, time, threading, uuid, sqlite3, urllib.request
from datetime import datetime, timezone

ARCHIVE = "/mnt/fluid-cloud/ai-archive/swarm7000"
DB = os.path.expanduser("~/.eon/swarm7000.db")
BLIND = "http://127.0.0.1:8090/v1/chat/completions"
SOVEREIGN = "http://127.0.0.1:3003/v1/chat/completions"
# eon-blind-proxy alias + a tested-reliable model on :8090 (523 models).
EON_BLIND_URL = BLIND
EON_BLIND_MODEL = "qwen/qwen3-coder:free"   # verified responsive (~5s) vs 'auto' slow chain
DB_LOCK = threading.Lock()

AGENT_TYPES = {
    "planner": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Break this task into numbered steps. Output only steps."},
    "coder": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Write production code. Output ONLY code with # filename header."},
    "researcher": {"model": "auto", "url": BLIND, "prompt": "Research this topic. Give concise facts. Do not write code."},
    "critic": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Review critically. Find bugs, edge cases, improvements."},
    "builder": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Build a complete working solution. Output only the implementation."},
    "memory": {"model": "auto", "url": BLIND, "prompt": "Summarize concisely. Keep key points only. Discard fluff."},
    "orchestrator": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Coordinate multiple subtasks. Assign work to appropriate agents."},
    "tester": {"model": "auto", "url": BLIND, "prompt": "Test this code. Find bugs, edge cases. Report PASS/FAIL for each case."},
    "writer": {"model": "auto", "url": BLIND, "prompt": "Write clear documentation. Explain what, why, and how."},
    "archiver": {"model": "auto", "url": BLIND, "prompt": "Organize and index information for long-term storage."},
    "deployer": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Deploy applications. Write Dockerfiles, docker-compose, and shell scripts. Output only the deployment commands."},
    "infra": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Manage infrastructure: systemd, Docker, Caddy, ports, networking. Output working shell commands."},
    "docker": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Docker specialist. Write Dockerfiles, docker-compose.yml, and container configs. Output only working files."},
    "caddy": {"model": EON_BLIND_MODEL, "url": EON_BLIND_URL, "prompt": "Caddy reverse proxy specialist. Write Caddyfile configs for virtual hosts, TLS, routing. Output only the Caddyfile."},
    "gateway": {"model": "auto", "url": BLIND, "prompt": "Manage the Fluid Storage Gateway. Give rclone commands, mount operations, and storage management steps."},
}

def call_llm(url, model, prompt, system=None, timeout=60):
    msgs = []
    if system: msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt[:2000]})
    data = json.dumps({"model": model, "messages": msgs, "max_tokens": 800}).encode()
    # Note: SOVEREIGN (:3003) is out of API key quota today (all providers
    # `no_api_key`). The live path is BLIND (:8090, 523 models). When the
    # primary URL is SOVEREIGN and it fails, fall back to BLIND /auto so the
    # swarm's planner/coder/critic/builder brains keep working.
    def _try(target_url, target_model):
        try:
            req = urllib.request.Request(target_url, data=json.dumps(
                {"model": target_model, "messages": msgs, "max_tokens": 800}).encode(),
                headers={"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=timeout)
            d = json.loads(resp.read())
            if d.get("choices"):
                return d["choices"][0]["message"]["content"]
            return None
        except Exception:
            return None
    out = _try(url, model)
    if out is None and url != BLIND:
        out = _try(BLIND, "auto")
    return out

def init_db():
    db = sqlite3.connect(DB, check_same_thread=False)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=5000")
    db.execute("CREATE TABLE IF NOT EXISTS tasks (id TEXT, parent TEXT, agent TEXT, prompt TEXT, status TEXT, result TEXT, worker TEXT, time REAL)")
    db.execute("CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, agent_type TEXT, status TEXT, task_id TEXT, heartbeat REAL, tasks_done INT DEFAULT 0)")
    db.execute("CREATE TABLE IF NOT EXISTS archive (id TEXT, agent TEXT, prompt TEXT, response TEXT, ts REAL)")
    db.commit()
    return db

def exec_db(db, sql, params=()):
    with DB_LOCK:
        try:
            return db.execute(sql, params)
        except Exception as e:
            return None

def save_archive(db, agent, prompt, response):
    rid = str(uuid.uuid4())[:8]
    ts = time.time()
    with DB_LOCK:
        db.execute("INSERT INTO archive VALUES (?,?,?,?,?)", (rid, agent, prompt[:500], response[:2000], ts))
        db.commit()
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    os.makedirs(f"{ARCHIVE}/{date}", exist_ok=True)
    with open(f"{ARCHIVE}/{date}/{agent}_{rid}.json", "w") as f:
        json.dump({"id": rid, "agent": agent, "prompt": prompt[:500], "response": response[:2000], "ts": ts}, f)
    return rid

class SwarmWorker(threading.Thread):
    def __init__(self, wid, agent_type, db, task_queue):
        super().__init__(daemon=True)
        self.wid = wid
        self.agent_type = agent_type
        self.db = db
        self.queue = task_queue
        self.tasks_done = 0
        self.daemon_flag = True

    def run(self):
        agent = AGENT_TYPES[self.agent_type]
        while self.daemon_flag:
            with DB_LOCK:
                self.db.execute("INSERT OR REPLACE INTO workers (id, agent_type, status, task_id, heartbeat, tasks_done) VALUES (?,?,?,?,?,?)",
                    (self.wid, self.agent_type, "idle", "", time.time(), self.tasks_done))
                self.db.commit()

            task = self.pop_task()
            if not task:
                time.sleep(2)
                continue

            task_id, prompt, parent = task
            with DB_LOCK:
                self.db.execute("UPDATE tasks SET status='running', worker=? WHERE id=?", (self.wid, task_id))
                self.db.commit()

            response = call_llm(agent["url"], agent["model"], prompt, system=agent["prompt"])

            if response:
                rid = save_archive(self.db, self.agent_type, prompt, response)
                with DB_LOCK:
                    self.db.execute("UPDATE tasks SET status='done', result=?, worker=? WHERE id=?",
                        (response[:2000], self.wid, task_id))
                    self.db.commit()
                self.tasks_done += 1
                self.auto_spawn(task_id, prompt, response)
            else:
                with DB_LOCK:
                    self.db.execute("UPDATE tasks SET status='failed' WHERE id=?", (task_id,))
                    self.db.commit()

    def pop_task(self):
        while self.daemon_flag:
            with DB_LOCK:
                tasks = self.db.execute(
                    "SELECT id, prompt, parent FROM tasks WHERE (agent=? OR agent='any') AND status='queued' ORDER BY time ASC LIMIT 1",
                    (self.agent_type,)).fetchall()
                if tasks:
                    t = tasks[0]
                    self.db.execute("UPDATE tasks SET status='claimed', worker=? WHERE id=? AND status='queued'",
                        (self.wid, t[0]))
                    self.db.commit()
                    if self.db.total_changes > 0:
                        return t
            time.sleep(1)

    def auto_spawn(self, parent_id, prompt, response):
        if not response:
            return
        lower = response.lower()
        has_steps = ("step 1" in lower or "first" in lower or
                     any(response.strip().startswith(f"{i}.") for i in range(1,4)))
        if has_steps:
            lines = [l.strip() for l in response.split("\n") if l.strip() and any(l.strip().startswith(f"{i}.") or l.strip().startswith(f"{i}:") for i in range(1,10))]
            lines = lines[:7]
            for step_text in lines:
                step_text = step_text.split(". ", 1)[-1] if ". " in step_text else step_text
                step_lower = step_text.lower()
                if any(w in step_lower for w in ["code", "write", "implement", "function", "print", "return"]):
                    agent = "coder"
                elif any(w in step_lower for w in ["research", "find", "what", "how", "explain", "understand"]):
                    agent = "researcher"
                elif any(w in step_lower for w in ["build", "create", "generate", "deploy", "construct"]):
                    agent = "builder"
                elif any(w in step_lower for w in ["review", "check", "test", "validate", "critique", "verify"]):
                    agent = "critic"
                elif any(w in step_lower for w in ["summarize", "save", "store", "organize", "remember"]):
                    agent = "memory"
                elif any(w in step_lower for w in ["deploy", "docker", "container", "compose", "dockerfile"]):
                    agent = "docker"
                elif any(w in step_lower for w in ["caddy", "reverse proxy", "tls", "https", "domain"]):
                    agent = "caddy"
                elif any(w in step_lower for w in ["infra", "systemd", "service", "port", "network", "firewall"]):
                    agent = "infra"
                elif any(w in step_lower for w in ["gateway", "mount", "rclone", "webdav", "storage"]):
                    agent = "gateway"
                else:
                    agent = "any"
                sid = str(uuid.uuid4())[:8]
                with DB_LOCK:
                    self.db.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)",
                        (sid, parent_id, agent, step_text[:500], "queued", "", "", time.time()))
                    self.db.commit()

class SwarmMaster:
    def __init__(self, num_workers=10):
        self.db = init_db()
        self.queue = []
        self.workers = []
        self.num_workers = num_workers
        self.agent_types = list(AGENT_TYPES.keys())
        self.daemon_flag = False
        print(f"🔥 EON 7000 Swarm — {num_workers} workers × {len(self.agent_types)} agent types")

    def start(self):
        for i in range(self.num_workers):
            atype = self.agent_types[i % len(self.agent_types)]
            w = SwarmWorker(f"w{i:04d}", atype, self.db, self.queue)
            w.start()
            self.workers.append(w)
        print(f"  ✅ {len(self.workers)} workers spawned")
        threading.Thread(target=self.health_check, daemon=True).start()

    def health_check(self):
        while True:
            time.sleep(15)
            for w in self.workers:
                if not w.is_alive() and w.daemon_flag:
                    print(f"  ♻️  Respawning {w.wid}")
                    nw = SwarmWorker(w.wid, w.agent_type, self.db, self.queue)
                    nw.start()
                    self.workers[self.workers.index(w)] = nw
            alive = sum(1 for w in self.workers if w.is_alive())
            with DB_LOCK:
                queued = self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='queued'").fetchone()[0]
                done = self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='done'").fetchone()[0]
                failed = self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='failed'").fetchone()[0]
                total = self.db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            print(f"  💓 {alive}/{self.num_workers} workers | {queued} queued | {done} done | {failed} failed | {total} total")

    def submit(self, prompt, agent="any", parent=""):
        tid = str(uuid.uuid4())[:8]
        with DB_LOCK:
            self.db.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)",
                (tid, parent, agent, prompt[:500], "queued", "", "", time.time()))
            self.db.commit()
        return tid

    def wait_for_completion(self, timeout=300):
        deadline = time.time() + timeout
        while time.time() < deadline:
            with DB_LOCK:
                pending = self.db.execute("SELECT COUNT(*) FROM tasks WHERE status IN ('queued','claimed','running')").fetchone()[0]
            if pending == 0:
                return True
            time.sleep(2)
        return False

    def get_results(self):
        with DB_LOCK:
            return self.db.execute(
                "SELECT id, agent, prompt, status FROM tasks ORDER BY time DESC LIMIT 20").fetchall()

    def get_archive(self):
        with DB_LOCK:
            return self.db.execute(
                "SELECT agent, prompt, response, ts FROM archive ORDER BY ts DESC LIMIT 20").fetchall()

    def stats(self):
        with DB_LOCK:
            return {
                "workers": sum(1 for w in self.workers if w.is_alive()),
                "total_workers": self.num_workers,
                "tasks_total": self.db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0],
                "tasks_done": self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='done'").fetchone()[0],
                "tasks_failed": self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='failed'").fetchone()[0],
                "tasks_queued": self.db.execute("SELECT COUNT(*) FROM tasks WHERE status='queued'").fetchone()[0],
                "archive_entries": self.db.execute("SELECT COUNT(*) FROM archive").fetchone()[0],
            }

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=10, help="Number of worker threads")
    parser.add_argument("--daemon", action="store_true", help="Run as background daemon")
    parser.add_argument("task", nargs="*", help="Task prompt")
    args = parser.parse_args()

    master = SwarmMaster(num_workers=args.workers)
    master.start()

    if args.daemon:
        print(f"Swarm daemon running with {args.workers} workers")
        master.daemon_flag = True
        while master.daemon_flag:
            time.sleep(60)
            s = master.stats()
            print(f"  💓 {s['workers']}/{s['total_workers']} | {s['tasks_done']} done | {s['tasks_failed']} failed | {s['archive_entries']} archived")
        return

    if args.task:
        prompt = " ".join(args.task)
        print(f"\nTask: {prompt[:80]}...")
        master.submit(prompt, agent="planner")
        master.wait_for_completion(timeout=180)
        results = master.get_results()
        for r in results:
            icon = "✅" if r[3] == "done" else "❌"
            print(f"  {icon} [{r[1]}] {r[2][:60]}...")
        print(f"\nStats: {json.dumps(master.stats(), indent=2)}")
        return

    print(f"\nInteractive mode. Commands: /workers, /queue, /done, /failed, /archive, /stats, /submit <task>, /quit")
    while True:
        try:
            cmd = input("  Swarm > ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); break
        if not cmd or cmd == "/quit": break
        if cmd == "/workers":
            for w in master.workers:
                a = "✅" if w.is_alive() else "❌"
                print(f"  {a} {w.wid} ({w.agent_type}) — {w.tasks_done} tasks")
        elif cmd == "/queue":
            with DB_LOCK:
                rows = master.db.execute("SELECT id, agent, prompt FROM tasks WHERE status='queued' LIMIT 10").fetchall()
            for r in rows: print(f"  [{r[0]}] {r[1]}: {r[2][:60]}...")
        elif cmd == "/done":
            rows = master.get_results()
            for r in rows[:10]: print(f"  ✅ [{r[1]}] {r[2][:60]}...")
        elif cmd == "/failed":
            with DB_LOCK:
                rows = master.db.execute("SELECT agent, prompt FROM tasks WHERE status='failed' ORDER BY time DESC LIMIT 10").fetchall()
            for r in rows: print(f"  ❌ [{r[0]}] {r[1][:60]}...")
        elif cmd == "/stats":
            print(json.dumps(master.stats(), indent=2))
        elif cmd == "/archive":
            rows = master.get_archive()
            for r in rows[:10]: print(f"  [{r[0]}] {r[1][:60]}... → {r[3][:60]}...")
        elif cmd.startswith("/submit "):
            task = cmd[8:]
            master.submit(task)
            print(f"  Submitted: {task[:60]}...")

if __name__ == "__main__":
    main()
