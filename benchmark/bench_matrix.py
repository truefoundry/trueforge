#!/usr/bin/env python3
"""TrueForge benchmark runner: {harness} x {task} x {trial}.

Runs the same task suite through one or more agent harnesses (TrueForge, Claude
Managed Agents, deepagents) on a model of your choice, one fresh session per task,
N trials each. Resumable by (harness, trial, task) — rerun to continue.

Pipeline:
    python bench_matrix.py run-all      # every configured harness, N trials
    python judge.py                     # blind grade every captured answer
    python aggregate.py                 # per-task pass-rate + cost/latency -> summary.csv

Robustness (each task runs as a subprocess with a hard wall-clock timeout; retries on
timeout / crash / empty answer). Config is entirely via environment — see .env.example.
"""
import os, sys, json, time, pathlib, subprocess

BENCH = pathlib.Path(__file__).parent
OUT = pathlib.Path(os.environ.get("OUT_DIR", str(BENCH / "results")))
MATRIX = OUT / "matrix.jsonl"
DATASET_DIR = pathlib.Path(os.environ.get("DATASET_DIR", str(BENCH / "dataset")))
SYSTEM_PROMPT = pathlib.Path(os.environ.get("SYSTEM_PROMPT", str(BENCH / "prompts" / "system.md"))).read_text()

N_TRIALS = int(os.environ.get("N_TRIALS", "3"))
TASK_TIMEOUT = int(os.environ.get("TASK_TIMEOUT", "1500"))   # hard per-task kill (seconds)
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))
# Which harnesses to run, comma-separated. Any of: tfy, cma, deepagents.
HARNESSES = [h.strip() for h in os.environ.get("HARNESSES", "tfy,cma,deepagents").split(",") if h.strip()]


def tasks():
    """Every task in DATASET_DIR: a subdir containing tests/criteria.yaml and prompt.txt."""
    return sorted(p.name for p in DATASET_DIR.iterdir()
                  if (p / "tests" / "criteria.yaml").exists() and (p / "prompt.txt").exists())


def prompt_for(task):
    return (DATASET_DIR / task / "prompt.txt").read_text().strip()


# ---------------- TrueForge adapter (native /api/v1 HTTP API, stdlib only) ----------------
def run_tfy(task, prompt, cap):
    import urllib.request
    base = os.environ["TFY_BASE_URL"].rstrip("/")
    mcp = json.loads(pathlib.Path(os.environ["MCP_CONFIG"]).read_text())     # {name: url}
    # Inline agent spec: the shared model + system prompt and the MCP connectors (by
    # the names they are registered under in TrueForge), autonomous (no approval gates).
    spec = {
        "model": {"name": os.environ["MODEL_TFY"]},
        "instructions": SYSTEM_PROMPT,
        "mcp_servers": [{"name": n, "enable_tools": ["@all"], "require_approval_for_tools": []}
                        for n in mcp],
        # Validated benchmark config (the setup that produced the published results):
        #  - fully autonomous: no approval gates (above) and no clarifying-question pauses,
        #    either of which would end a turn early with incomplete work;
        #  - dynamic sub-agents ON and a 500-iteration budget, so the agent can fully work
        #    the data-heavy cross-system tasks (decompose big sub-tasks, take enough steps);
        #  - compaction + large_tool_response keep long turns under the token budget:
        #    large_tool_response OFFLOADS oversized query results to a sandbox file instead
        #    of piling them into context. This REQUIRES a sandbox provider configured in
        #    TrueForge (see README "Sandbox"); without one the offload can't happen and the
        #    heaviest tasks abort with "max_tokens breached".
        "config": {
            "iteration_limit": int(os.environ.get("TFY_ITERATION_LIMIT", "500")),
            "ask_user_questions": {"enabled": False},
            "dynamic_sub_agents": {"enabled": True},
            "sandbox": {"enabled": True},
            "context_management": {
                "compaction": {
                    "enabled": True,
                    "trigger": {"type": "input_tokens", "value": 60000},
                },
                "large_tool_response": {"enabled": True},
            },
            "generative_ui": {"enabled": False},
        },
    }

    def _post(path, body, stream=False):
        req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Accept": "text/event-stream" if stream else "application/json"}, method="POST")
        return urllib.request.urlopen(req, timeout=TASK_TIMEOUT)

    def _get(path):
        req = urllib.request.Request(base + path, headers={"Accept": "application/json"})
        return json.load(urllib.request.urlopen(req, timeout=60))

    def text_of(content):
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
        return ""

    sid = json.load(_post("/api/v1/sessions", {"agent": {"spec": spec}}))["data"]["id"]
    tot = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    tools = 0; answer = ""; last_msg = ""; cost = None; terminal = False
    resp = _post(f"/api/v1/sessions/{sid}/turns",
                 {"input": [{"type": "user.message", "content": prompt}],
                  "previous_turn_id": "none", "stream": True}, stream=True)
    for raw in resp:                                          # Server-Sent Events, one JSON object per `data:` line
        line = raw.decode("utf-8", "ignore").strip()
        if not line.startswith("data:"):
            continue
        try:
            ev = json.loads(line[5:].strip())
        except Exception:
            continue
        et = ev.get("type", "")
        if et == "tool.response":
            tools += 1
        elif et == "model.message":
            t = text_of(ev.get("content"))
            if t.strip():
                last_msg = t
        elif et == "turn.done":
            state = ev.get("state", {}) or {}
            m = state.get("metrics") or {}
            tot = {"input": m.get("total_input_tokens", 0) or 0,
                   "output": m.get("total_output_tokens", 0) or 0,
                   "cache_read": m.get("total_cache_read_tokens", 0) or 0,
                   "cache_write": m.get("total_cache_write_tokens", 0) or 0}
            cost = m.get("total_cost_in_usd")
            out = state.get("output") or {}
            answer = text_of(out.get("content") if isinstance(out, dict) else None)
            terminal = True
            break
    # On the data-heavy tasks a turn can run for several minutes, and the SSE stream may
    # close before the turn finishes (the turn keeps running server-side). Don't treat the
    # stream ending as "done" — poll the turn to its terminal state so we capture the real
    # answer/metrics instead of an empty result. This is what keeps the heaviest tasks from
    # being scored as spurious failures.
    if not terminal:
        try:
            turns = _get(f"/api/v1/sessions/{sid}/turns").get("data", []) or []
            tid = (turns[0] if turns else {}).get("id")
            deadline = time.time() + TASK_TIMEOUT
            while tid and time.time() < deadline:
                st = (_get(f"/api/v1/sessions/{sid}/turns/{tid}").get("data", {}) or {}).get("state", {}) or {}
                if st.get("status") in ("done", "error", "cancelled"):
                    m = st.get("metrics") or {}
                    tot = {"input": m.get("total_input_tokens", 0) or 0,
                           "output": m.get("total_output_tokens", 0) or 0,
                           "cache_read": m.get("total_cache_read_tokens", 0) or 0,
                           "cache_write": m.get("total_cache_write_tokens", 0) or 0}
                    cost = m.get("total_cost_in_usd")
                    out = st.get("output") or {}
                    answer = text_of(out.get("content") if isinstance(out, dict) else None) or answer
                    break
                time.sleep(6)
        except Exception:
            pass
    if not answer:
        answer = last_msg
    res = {"session_id": sid, "tokens": tot, "tool_calls": tools, "answer": answer}
    if cost is not None:
        res["cost_usd"] = cost                                # harness-reported cost, kept for cross-check
    cap.put(res)


# ---------------- Claude Managed Agents adapter ----------------
def run_cma(task, prompt, cap):
    import anthropic
    ids = json.loads(pathlib.Path(os.environ["CMA_IDS"]).read_text())   # {agent_id, env_id, vault_id?}
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    kw = {"agent": ids["agent_id"], "environment_id": ids["env_id"], "title": f"bench {task}"}
    if ids.get("vault_id"):
        kw["vault_ids"] = [ids["vault_id"]]
    s = client.beta.sessions.create(**kw)
    ans = ""; tools = 0
    with client.beta.sessions.events.stream(s.id) as stream:
        client.beta.sessions.events.send(s.id, events=[{"type": "user.message",
            "content": [{"type": "text", "text": prompt}]}])
        for e in stream:
            et = getattr(e, "type", "")
            if et == "agent.message":
                txt = "\n".join([getattr(b, "text", "") or "" for b in getattr(e, "content", []) or []])
                if txt:
                    ans = txt
            elif et in ("agent.tool_use", "agent.mcp_tool_use"):
                tools += 1
            elif et == "session.status_idle":
                break
    u = getattr(client.beta.sessions.retrieve(s.id), "usage", None)
    tot = {"input": getattr(u, "input_tokens", 0) or 0, "output": getattr(u, "output_tokens", 0) or 0,
           "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
           "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0}
    cap.put({"session_id": s.id, "tokens": tot, "tool_calls": tools, "answer": ans})


# ---------------- deepagents (LangGraph) adapter ----------------
def run_deepagents(task, prompt, cap):
    import asyncio
    from langchain_mcp_adapters.client import MultiServerMCPClient
    from langchain_openai import ChatOpenAI
    from deepagents import create_deep_agent
    mcp = json.loads(pathlib.Path(os.environ["MCP_CONFIG"]).read_text())

    async def _run():
        client = MultiServerMCPClient({n: {"url": u, "transport": "streamable_http"} for n, u in mcp.items()})
        tools = await client.get_tools()
        model = ChatOpenAI(model=os.environ["DA_MODEL"], base_url=os.environ["DA_BASE_URL"],
                           api_key=os.environ["DA_API_KEY"], timeout=180, max_retries=5)
        agent = create_deep_agent(model=model, tools=tools, system_prompt=SYSTEM_PROMPT)
        res = await agent.ainvoke({"messages": [{"role": "user", "content": prompt}]},
                                  {"recursion_limit": int(os.environ.get("DA_RECURSION", "300"))})
        tot = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}; tools_n = 0; answer = ""
        for m in res["messages"]:
            if m.__class__.__name__ != "AIMessage":
                continue
            um = getattr(m, "usage_metadata", None) or {}
            tot["input"] += int(um.get("input_tokens", 0) or 0); tot["output"] += int(um.get("output_tokens", 0) or 0)
            det = um.get("input_token_details", {}) or {}
            tot["cache_read"] += int(det.get("cache_read", 0) or 0); tot["cache_write"] += int(det.get("cache_creation", 0) or 0)
            tools_n += len(getattr(m, "tool_calls", []) or [])
            c = getattr(m, "content", None)
            if isinstance(c, str) and c.strip():
                answer = c
            elif isinstance(c, list):
                txt = "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") in (None, "text"))
                if txt.strip():
                    answer = txt
        # Grade the reply, exactly like the other arms. Fallback only: if the agent left
        # its answer in its virtual filesystem instead of the reply, grade those files so
        # deepagents is not under-graded — this never adds to any other arm's answer.
        if not answer.strip():
            parts = []
            for p, fd in (res.get("files") or {}).items():
                if "large_tool_results" in p:        # offloaded raw tool dumps — scratch, not deliverable
                    continue
                content = fd.get("content") if isinstance(fd, dict) else getattr(fd, "content", None)
                if isinstance(content, list):
                    content = "\n".join(str(x) for x in content)
                if content and str(content).strip():
                    parts.append(f"### FILE: {p}\n{content}")
            answer = "\n\n".join(parts)
        return {"session_id": f"da-{task}", "tokens": tot, "tool_calls": tools_n, "answer": answer}

    cap.put(asyncio.run(_run()))


ADAPTER = {"tfy": run_tfy, "cma": run_cma, "deepagents": run_deepagents}


def _done_cells():
    d = set()
    if MATRIX.exists():
        for line in MATRIX.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("status") == "ok" and r.get("answer_chars", 0) > 0:
                d.add((r["harness"], r["trial"], r["task"]))
    return d


def run_cell(harness, trial, task):
    outdir = OUT / harness / f"t{trial}"; outdir.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        tmp = OUT / f".cell_{harness}_t{trial}_{task}.json"
        if tmp.exists():
            tmp.unlink()
        t0 = time.time()
        try:
            subprocess.run([sys.executable, str(BENCH / "bench_matrix.py"), "_one", harness, task, str(tmp)],
                           timeout=TASK_TIMEOUT, env=os.environ, cwd=str(BENCH))
        except subprocess.TimeoutExpired:
            print(f"  [{harness} t{trial} {task}] TIMEOUT attempt {attempt}", flush=True); time.sleep(3); continue
        if not tmp.exists():
            print(f"  [{harness} t{trial} {task}] crashed attempt {attempt}", flush=True); time.sleep(5 * attempt); continue
        try:
            res = json.loads(tmp.read_text()); tmp.unlink()
        except Exception:
            print(f"  [{harness} t{trial} {task}] bad-output attempt {attempt}", flush=True); time.sleep(5 * attempt); continue
        if not res.get("answer"):
            print(f"  [{harness} t{trial} {task}] empty answer attempt {attempt}", flush=True); time.sleep(5 * attempt); continue
        (outdir / f"{task}.md").write_text(res["answer"])
        row = {"harness": harness, "trial": trial, "task": task, "status": "ok",
               "session_id": res.get("session_id"), "latency_s": round(time.time() - t0, 1),
               "tool_calls": res["tool_calls"], "tokens": res["tokens"], "answer_chars": len(res["answer"])}
        with open(MATRIX, "a") as f:
            f.write(json.dumps(row) + "\n")
        print(f"  [{harness} t{trial} {task}] ok  {row['latency_s']}s  tools={row['tool_calls']}", flush=True)
        return
    with open(MATRIX, "a") as f:
        f.write(json.dumps({"harness": harness, "trial": trial, "task": task, "status": "failed", "answer_chars": 0}) + "\n")
    print(f"  [{harness} t{trial} {task}] FAILED after {MAX_ATTEMPTS} attempts", flush=True)


def run_harness(harness, trials):
    done = _done_cells()
    for trial in range(1, trials + 1):
        for task in tasks():
            if (harness, trial, task) in done:
                print(f"skip {harness} t{trial} {task}", flush=True); continue
            run_cell(harness, trial, task)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    mode = sys.argv[1]
    if mode == "_one":
        # private single-cell worker: run one adapter, write result JSON, exit
        harness, task, outpath = sys.argv[2], sys.argv[3], sys.argv[4]
        class _Cap:
            val = None
            def put(self, x): self.val = x
        cap = _Cap()
        ADAPTER[harness](task, prompt_for(task), cap)
        pathlib.Path(outpath).write_text(json.dumps(cap.val))
        sys.exit(0)
    elif mode == "run":
        run_harness(sys.argv[2], N_TRIALS)
    elif mode == "run-all":
        for h in HARNESSES:
            run_harness(h, N_TRIALS)
    else:
        print(__doc__); sys.exit(1)
