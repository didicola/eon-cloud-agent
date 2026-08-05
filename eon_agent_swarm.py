# EON Autonomous Agent Swarm — specialized agents that self-orchestrate
import json, os, sys, time, threading, urllib.request, uuid, sqlite3
from datetime import datetime

ARCHIVE = "/mnt/fluid-cloud/ai-archive/swarm"
STATE_DB = os.path.expanduser("~/.eon/swarm.db")
BLIND = "http://127.0.0.1:8090/v1/chat/completions"
SOVEREIGN = "http://127.0.0.1:3003/v1/chat/completions"

def call(url, model, prompt, timeout=60):
    data = json.dumps({"model": model, "messages": [
        {"role": "system", "content": "You are a precise agent. Output only what is asked."},
        {"role": "user", "content": prompt}], "max_tokens": 500}).encode()
    try:
        req = urllib.request.Request(url, data=data,
            headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        d = json.loads(resp.read())
        return d["choices"][0]["message"]["content"]
    except Exception as e:
        return None

def init_db():
    db = sqlite3.connect(STATE_DB)
    db.execute("CREATE TABLE IF NOT EXISTS agents (id TEXT, name TEXT, role TEXT, status TEXT, task TEXT, result TEXT, time REAL)")
    db.execute("CREATE TABLE IF NOT EXISTS tasks (id TEXT, prompt TEXT, plan TEXT, status TEXT, result TEXT, time REAL)")
    db.commit()
    return db

def log_agent(db, name, role, status, task, result=""):
    db.execute("INSERT INTO agents VALUES (?,?,?,?,?,?,?)",
        (str(uuid.uuid4())[:8], name, role, status, task[:200], result[:500], time.time()))
    db.commit()

def log_task(db, tid, prompt, plan="", status="created", result=""):
    db.execute("INSERT OR REPLACE INTO tasks VALUES (?,?,?,?,?,?)",
        (tid, prompt[:500], plan[:500], status, result[:500], time.time()))
    db.commit()

def save_to_mega(name, prompt, response, metadata=""):
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    date = datetime.utcnow().strftime("%Y-%m-%d")
    os.makedirs(f"{ARCHIVE}/{date}", exist_ok=True)
    path = f"{ARCHIVE}/{date}/{name}_{ts}.json"
    entry = {"ts": ts, "agent": name, "prompt": prompt[:300], "response": response[:1000], "meta": metadata}
    with open(path, "w") as f:
        json.dump(entry, f, indent=2)
    return path

# ─── Agent Definitions ──────────────────────────────────────

AGENTS = {
    "planner": {
        "model": "gpt-4.1",
        "url": SOVEREIGN,
        "system": "You are a project planner. Break tasks into 3-5 concrete, executable steps. Each step must be directly actionable. Output only numbered steps, nothing else."
    },
    "coder": {
        "model": "gpt-4.1",
        "url": SOVEREIGN,
        "system": "You write production code. Output ONLY the code with a # filename comment. No explanations."
    },
    "researcher": {
        "model": "auto",
        "url": BLIND,
        "system": "You are a technical researcher. Give concise answers with key facts. Do not write code."
    },
    "critic": {
        "model": "gpt-4.1",
        "url": SOVEREIGN,
        "system": "You are a code reviewer. Check for bugs, edge cases, and improvements. Be critical and specific."
    },
    "builder": {
        "model": "gpt-4.1",
        "url": SOVEREIGN,
        "system": "You build and compile complete solutions. Output working implementations only."
    },
    "memory": {
        "model": "auto",
        "url": BLIND,
        "system": "You summarize and organize information. Condense into key points, discard fluff."
    },
}

def run_agent(agent_name, task, context=""):
    agent = AGENTS.get(agent_name)
    if not agent:
        return None
    prompt = f"{agent['system']}\n\nContext: {context}\n\nTask: {task}"
    response = call(agent["url"], agent["model"], prompt)
    return response

class SwarmOrchestrator:
    def __init__(self):
        self.db = init_db()
        self.active = 0

    def solve(self, task):
        tid = str(uuid.uuid4())[:8]
        print(f"  Swarm [{tid}]: {task[:60]}...")
        log_task(self.db, tid, task, status="planning")

        # Phase 1: Planner decomposes
        plan = run_agent("planner", task)
        if not plan:
            print("    ❌ Planner failed, using task directly")
            plan = task
        log_task(self.db, tid, task, plan=plan[:500], status="planned")
        print(f"    Plan: {plan[:200]}")
        save_to_mega("planner", task, plan[:1000], tid)

        steps = [s.strip() for s in plan.split("\n") if s.strip() and s[0].isdigit()]
        if not steps:
            steps = [task]
        results = []

        # Phase 2: Route each step to the right agent based on keywords
        for step in steps[:5]:
            step_clean = step.split(". ", 1)[-1] if ". " in step else step
            print(f"    Step: {step_clean[:60]}...")

            step_lower = step_clean.lower()
            if any(w in step_lower for w in ["code", "write", "implement", "function", "script", "class", "def ", "import", "print", "return"]):
                preferred = ["coder", "builder", "critic"]
            elif any(w in step_lower for w in ["research", "find", "what", "how", "explain", "fact", "tell", "describe", "list", "analyze"]):
                preferred = ["researcher", "memory", "critic"]
            elif any(w in step_lower for w in ["build", "compile", "create", "generate", "deploy", "setup", "install", "configure"]):
                preferred = ["builder", "coder", "critic"]
            elif any(w in step_lower for w in ["review", "check", "test", "validate", "critique", "verify", "audit", "debug"]):
                preferred = ["critic", "coder", "researcher"]
            elif any(w in step_lower for w in ["summarize", "save", "store", "remember", "organize", "index"]):
                preferred = ["memory", "researcher", "coder"]
            else:
                preferred = ["coder", "researcher", "builder", "critic", "memory"]

            for agent_name in preferred:
                response = run_agent(agent_name, step_clean, context=f"Task: {task}\nPlan: {plan}")
                if response:
                    path = save_to_mega(agent_name, step_clean, response, tid)
                    log_agent(self.db, agent_name, agent_name, "done", step_clean, response)
                    results.append({"agent": agent_name, "step": step_clean, "result": response[:200], "saved": path})
                    print(f"      {agent_name} → done")
                    break
                else:
                    log_agent(self.db, agent_name, agent_name, "failed", step_clean, "no response")

        # Phase 3: Critic reviews
        if results:
            summary = "\n".join([f"[{r['agent']}] {r['step']}: {r['result'][:100]}" for r in results])
            critique = run_agent("critic", f"Review these results:\n{summary}\n\nOriginal task: {task}")
        else:
            summary = f"Task: {task}\nNo agents produced results."
            critique = run_agent("critic", f"Review this task:\n{task}\n\nNo results were produced. What went wrong?")
        if critique:
            save_to_mega("critic", summary, critique, tid)
            log_agent(self.db, "critic", "critic", "done", summary, critique)
            print(f"    Critique: {critique[:200]}")

        log_task(self.db, tid, task, plan=plan, status="done", result=summary[:500])

        # Phase 4: Save final to MEGA
        final = {"id": tid, "task": task, "plan": plan, "results": results,
                 "critique": critique, "ts": time.time()}
        final_path = f"{ARCHIVE}/{datetime.utcnow().strftime('%Y-%m-%d')}/final_{tid}.json"
        os.makedirs(os.path.dirname(final_path), exist_ok=True)
        with open(final_path, "w") as f:
            json.dump(final, f, indent=2)

        print(f"    ✅ Swarm complete — saved to {final_path}")
        return final

def daemon_loop():
    swarm = SwarmOrchestrator()
    print(f"Swarm daemon: {list(AGENTS.keys())}")
    while True:
        time.sleep(60)
        rows = swarm.db.execute("SELECT COUNT(*) FROM tasks WHERE time > ?", (time.time() - 3600,)).fetchone()
        print(f"  💓 Tasks in last hour: {rows[0]}")
        rows = swarm.db.execute("SELECT COUNT(*) FROM agents WHERE status='failed' AND time > ?", (time.time() - 3600,)).fetchone()
        if rows[0] > 3:
            print(f"  ⚠️  {rows[0]} agent failures in last hour")

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--daemon":
        daemon_loop()
        return

    print("EON AGI Agent Swarm")
    print(f"  Agents: {list(AGENTS.keys())}")
    print(f"  Archive: {ARCHIVE}")
    print(f"  Models: Blind Proxy (523) + Sovereign Router (GPT-4.1)\n")

    swarm = SwarmOrchestrator()

    while True:
        try:
            task = input("  Task > ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); break
        if not task or task == "/quit":
            break
        if task == "/agents":
            for name, agent in AGENTS.items():
                print(f"  {name}: {agent['model']} @ {'sovereign' if '3003' in agent['url'] else 'blind'}")
            continue
        if task == "/history":
            rows = swarm.db.execute("SELECT id, prompt, status, time FROM tasks ORDER BY time DESC LIMIT 5").fetchall()
            for r in rows:
                print(f"  [{r[0]}] {r[1][:60]}... {r[2]}")
            continue

        t0 = time.time()
        result = swarm.solve(task)
        elapsed = time.time() - t0
        if result:
            print(f"\n  ⏱ {elapsed:.1f}s | {len(result.get('results',[]))} agents involved\n")

if __name__ == "__main__":
    main()
