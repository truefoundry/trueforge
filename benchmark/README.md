# Agent-harness benchmark: cost & accuracy

A small, self-contained harness for running the **same agent task suite** through
three agent frameworks on the model of your choice, grading the answers with a
**blind LLM judge**, and reporting **accuracy, cost, and latency** side by side.

Built by TrueFoundry to compare [TrueForge](https://github.com/truefoundry/trueforge) (our
open-source agent harness) against **Claude Managed Agents (CMA)** on a suite of
cross-system enterprise tasks; a **deepagents** (LangGraph) arm is included as well.
Everything here is what we run — no hidden scoring, no per-task hints, one uniform
prompt for every framework. Point it at your own dataset and models and you should
reproduce our shape of results.

---

## What it measures

The suite is a set of **cross-system data tasks** over three backend services
exposed as MCP servers:

- **pm** — a Jira-style project-management server (issues, comments, components, wiki)
- **crm** — a Salesforce-style CRM (SOQL-like query, records, schema describe)
- **file-server** — a Drive-style document store (search, read, metadata)

Each task asks a question that requires **joining data across two or three of
these systems** (for example: tie open support tickets to the CRM accounts they
belong to and the engineering components behind them). The agent has to discover
the schemas, figure out the joins, pull the data, and write a grounded answer.

### The dataset

We run against the **L1-L2 tasks from [DevRev's Enterprise-Bench](https://x.com/devrev/status/2075815567458734468)**,
which DevRev open-sourced — dataset, grading criteria, and their
[Harbor](https://github.com/harbor-framework/harbor) evaluation harness (the dataset
is published on Harbor Hub). We do **not** redistribute their data here — get it from
DevRev's release and point `DATASET_DIR` at it. The harness expects each task as:

```
dataset/
  <task-id>/
    prompt.txt              # the task instruction given to the agent
    tests/criteria.yaml     # the required criteria the judge grades against
```

Any suite in that shape works — this harness is not DevRev-specific.

---

## The three arms

| Arm          | Framework                             | How the agent runs                               | Tools                                         |
| ------------ | ------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `tfy`        | TrueForge (TrueFoundry Agent Harness) | Session via TrueForge's own HTTP API (`/api/v1`) | MCP servers registered in TrueForge (by name) |
| `cma`        | Claude Managed Agents (beta)          | Anthropic-hosted session + sandbox               | `mcp_toolset` attached to the agent           |
| `deepagents` | deepagents (LangGraph)                | Local `create_deep_agent` loop                   | MCP tools via `MultiServerMCPClient`          |

Every arm gets the **same system prompt** (`prompts/system.md`) and the **same task
prompts**. The prompt is short, model-neutral guidance — answer at the right
granularity, and use all the related data — with no task-specific detail.

---

## How it works

1. **`setup.py`** — creates the CMA environment/agent/vault with the shipped system
   prompt and the MCP servers. TrueForge and deepagents need no setup step here: TrueForge
   sends an inline agent spec when it creates each session, and deepagents attaches the
   MCP tools at run time. (TrueForge does need three things configured on its side — a model
   provider, the MCP Connectors, and a **sandbox provider** — see **TrueForge setup** below.)
2. **`bench_matrix.py run-all`** — runs every `{arm × task × trial}` cell. Each task
   runs as a subprocess with a hard wall-clock timeout and is retried on
   timeout / crash / empty answer. Fully resumable — rerun to continue.
   Answers land in `results/<arm>/t<trial>/<task>.md`; metrics in `results/matrix.jsonl`.
3. **`judge.py`** — grades every answer against its `criteria.yaml`. The judge sees
   only the criteria and the answer, never a reference value and never which arm
   produced it. A task PASSES only if **every** required criterion is met (no
   partial credit). Writes `results/grades.jsonl`.
4. **`aggregate.py`** — rolls the matrix up into per-arm accuracy, cost, and latency.
   `Solved / 14` is the mean number of tasks passed per trial. Writes `results/summary.csv`.

### TrueForge setup (required to reproduce)

The `tfy` arm talks to a running TrueForge server (`TFY_BASE_URL`). Before running it,
configure three things **inside TrueForge** — miss any one and the data-heavy tasks fail:

1. **A model provider** for `MODEL_TFY` (e.g. `anthropic/claude-opus-4-8`, `zai/glm-5-2`).
2. **The MCP servers** from `mcp_config.json`, registered as Connectors **under the same
   names**.
3. **A sandbox provider** (e.g. Daytona). This is the one people miss. The benchmark config
   enables `large_tool_response`, which **offloads oversized query results to a sandbox
   file** instead of letting them pile into the model's context. Several of these tasks scan
   tens of thousands of records; **without a sandbox the context blows past the token budget
   and the turn aborts with `max_tokens breached`.**

The agent config is sent **inline by the adapter** (`run_tfy` in `bench_matrix.py`) — you do
not set it in TrueForge — and is the validated setup that produced the results below:

| Setting                                  | Value                         | Why                                                      |
| ---------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `iteration_limit`                        | **500**                       | enough tool-use steps to fully work a cross-system task  |
| `dynamic_sub_agents`                     | **enabled**                   | decompose big sub-tasks to sub-agents with fresh context |
| `sandbox`                                | **enabled**                   | needed for `large_tool_response` offload (see #3 above)  |
| `context_management.compaction`          | **enabled, threshold 60 000** | summarize old history so long turns stay under budget    |
| `context_management.large_tool_response` | **enabled**                   | offload oversized tool results to the sandbox            |
| `generative_ui`                          | disabled                      | not needed for a headless benchmark                      |
| `ask_user_questions`                     | disabled                      | fully autonomous; never pause a turn for input           |

**Long turns.** The heaviest tasks run for several minutes. TrueForge streams turn events
over SSE, and on a long turn that stream can close before the turn finishes (the turn keeps
running server-side). The adapter handles this: if the stream ends without a terminal
`turn.done`, it **polls the turn to its terminal state** rather than recording an empty
answer. If you write your own client, do the same, or long tasks will look like spurious
failures.

**Strict MCP servers.** The MCP spec requires clients to send
`Accept: application/json, text/event-stream`. If your MCP server enforces this strictly and
TrueForge's connector doesn't satisfy it, tool listing fails; use an MCP server (or a thin
proxy) that accepts the header TrueForge sends.

### Cost model

Cost is computed from token counts at provider list prices (`$/1M`), not estimated:

```
cost = (uncached_input * in_rate
        + output        * out_rate
        + cache_read    * cache_read_rate
        + cache_write   * cache_write_rate) / 1e6
```

Token semantics differ by framework, so `aggregate.py` normalizes them
(`INPUT_IS_TOTAL`): for TrueForge and deepagents, `input` is the **total** prompt
and cache reads/writes are a subset (`uncached = input - cache_read - cache_write`);
for CMA, `input` is already the uncached count. Rates default to Opus 4.8; override
per arm with `RATES_<ARM>` (see `.env.example`) when an arm runs a different model.

---

## Run it

```bash
# 1. install (core arms + judge)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2. configure
cp .env.example .env            # fill in keys, hosts, models
cp mcp_config.example.json mcp_config.json   # your three MCP server URLs
source .env

# 3. run the full pipeline
python setup.py
python bench_matrix.py run-all
python judge.py
python aggregate.py             # prints the table, writes results/summary.csv
```

Run a single arm with `HARNESSES=tfy python bench_matrix.py run-all` (or `run tfy`).

The **deepagents** arm pulls in LangGraph/LangChain, which can conflict with the
core stack. If pip complains, create a second venv from
`requirements-deepagents.txt` and run `HARNESSES=deepagents python bench_matrix.py run tfy`
there; the `results/` directory is shared, so `judge.py` / `aggregate.py` pick it up.

Docker: `docker build -t trueforge-bench . && docker run --env-file .env -v $PWD/results:/bench/results trueforge-bench`
(runs the core arms; see above for deepagents).

---

## Our results

The DevRev L1-L2 suite is **14 tasks**, each run in a fresh session over **n = 3
trials**. `Solved / 14` is the mean number of tasks passed per trial (blind judge,
all-or-nothing); cost is per run at provider list prices.

| Configuration                    |  n  | Solved / 14 | Cost / run | Tokens / run |
| -------------------------------- | :-: | :---------: | :--------: | :----------: |
| Claude Managed Agents · Opus 4.8 |  3  |    10.7     |   $11.8    |    10.0M     |
| TrueForge · Opus 4.8             |  3  |    10.7     |    $8.6    |     3.7M     |
| TrueForge · GLM-5.2              |  3  |    11.7     |    $3.0    |     3.8M     |

On the **same model (Opus 4.8)**, TrueForge and Claude Managed Agents solve the same
number of tasks (10.7 each) — matched accuracy — while TrueForge uses far fewer tokens
per run (3.7M vs 10.0M) and so costs less ($8.6 vs $11.8, ~27% lower). Running
TrueForge on the open model **GLM-5.2** solves 11.7 / 14 at $3.0 per run — about 75%
below Claude Managed Agents. Numbers move a task or two run to run, so reproduce the
shape, not a single cell, and plug in your own models and rates.

A **deepagents** (LangGraph) arm is also included in the kit and can be run the same way.

---

## Files

```
prompts/system.md            the single system prompt (identical for every arm)
mcp_config.example.json      template for your three MCP server URLs
setup.py                     create the CMA env/agent/vault (TrueForge + deepagents need none)
bench_matrix.py              run {arm × task × trial}; resumable, timeout-guarded
judge.py                     blind criteria-only grader
aggregate.py                 accuracy + cost + latency -> summary.csv
requirements.txt             core arms + judge
requirements-deepagents.txt  deepagents arm (separate venv)
Dockerfile                   core pipeline
.env.example                 all configuration
```

## Method

- **Same prompt, same tasks.** Every arm gets the identical system prompt and task
  prompts, and each answer is graded from the arm's reply.
- **Blind, strict judge.** The judge sees only the criteria and the answer — never the
  reference values or which arm produced it; a task passes only if every required
  criterion is met (no partial credit).
- **List-price cost.** Computed per cell from token counts at provider list prices,
  normalized for each framework's token reporting.
- **Dataset.** DevRev's Enterprise-Bench; we point at their release and do not ship it.
- **Trials.** Report the mean across trials and compare distributions, not a single cell.
