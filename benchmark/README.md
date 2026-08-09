# Agent-harness benchmark: cost & accuracy

A small, self-contained harness for running the **same agent task suite** through
three agent frameworks on the model of your choice, grading the answers with a
**blind LLM judge**, and reporting **accuracy, cost, and latency** side by side.

Built by TrueFoundry to compare [TrueForge](https://github.com/truefoundry) (our
open-source agent harness) against **Claude Managed Agents (CMA)** and
**deepagents** on a suite of cross-system enterprise tasks. Everything here is
what we run — no hidden scoring, no per-task hints, one uniform prompt for every
framework, and no arm-specific model tuning. Point it at your own dataset and
models and you should reproduce our shape of results.

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

We run against the **L1-L2 tasks from DevRev's Enterprise-Bench**, which DevRev
open-sourced (dataset + grading criteria + their own Harbor harness). We do **not**
redistribute their data here — get it from DevRev's release and point `DATASET_DIR`
at it. The harness expects each task as:

```
dataset/
  <task-id>/
    prompt.txt              # the task instruction given to the agent
    tests/criteria.yaml     # the required criteria the judge grades against
```

Any suite in that shape works — this harness is not DevRev-specific.

---

## The three arms

| Arm | Framework | How the agent runs | Tools |
|-----|-----------|--------------------|-------|
| `tfy` | TrueForge (TrueFoundry Agent Harness) | Hosted agent session via the gateway SDK | Native MCP servers on the agent |
| `cma` | Claude Managed Agents (beta) | Anthropic-hosted session + sandbox | `mcp_toolset` attached to the agent |
| `deepagents` | deepagents (LangGraph) | Local `create_deep_agent` loop | MCP tools via `MultiServerMCPClient` |

Every arm gets the **same system prompt** (`prompts/system.md`) and the **same task
prompts**. The prompt is generic operating guidance — how to approach a cross-system
task, be thorough with sources, ground claims, respect scope. There is no
task-specific coaching and no answer key anywhere in the prompt or the judge.

---

## How it works

1. **`setup.py`** — creates the CMA environment/agent/vault and registers the
   TrueForge agent, both with the shipped system prompt and the MCP servers.
   (deepagents needs no setup.)
2. **`bench_matrix.py run-all`** — runs every `{arm × task × trial}` cell. Each task
   runs as a subprocess with a hard wall-clock timeout and is retried on
   timeout / crash / empty answer. Fully resumable — rerun to continue.
   Answers land in `results/<arm>/t<trial>/<task>.md`; metrics in `results/matrix.jsonl`.
3. **`judge.py`** — grades every answer against its `criteria.yaml`. The judge sees
   only the criteria and the answer, never a reference value and never which arm
   produced it. A task PASSES only if **every** required criterion is met (no
   partial credit). Writes `results/grades.jsonl`.
4. **`aggregate.py`** — rolls the matrix up into per-arm accuracy, cost, and
   latency. A task is **solved** when it passes in the **majority** of trials.
   Writes `results/summary.csv`.

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

The DevRev L1-L2 suite is **14 tasks**. We ran **n = 3 trials** per cell; a task is
solved when it passes in ≥ 2 of 3. Same uniform prompt, same tasks, blind judge.
Cost is per run (one task, averaged across trials) at provider list prices.

| Arm | Model | Solved / 14 | Cost / run | Tokens / run |
|-----|-------|:-----------:|:----------:|:------------:|
| TrueForge | open model | ~11 | ~$2.9 | 3.7M |
| TrueForge | Opus 4.8 | ~10 | ~$8.5 | 3.8M |
| Claude Managed Agents | Opus 4.8 | ~11 | ~$11.8 | 10M |
| deepagents | Opus 4.8 | ~11 | ~$21 | —¹ |

¹ deepagents per-run token totals were not recorded on the same basis as the other
arms; its cost comes from its own usage metadata.

Read plainly: on the **same model (Opus 4.8)** the three harnesses landed within a
task of each other on accuracy (CMA ~11, TrueForge ~10, deepagents ~11), so quality
is comparable across the board. The separation is in cost per run at list prices,
and the **open-model TrueForge arm** reached accuracy in the same range at the
lowest cost of any arm. Numbers move a task or two run to run — expected for n = 3
on hard cross-system tasks — so reproduce the shape, not a single cell, and plug in
your own models and rates.

---

## Files

```
prompts/system.md            the single system prompt (identical for every arm)
mcp_config.example.json      template for your three MCP server URLs
setup.py                     create/register the CMA + TrueForge agents
bench_matrix.py              run {arm × task × trial}; resumable, timeout-guarded
judge.py                     blind criteria-only grader
aggregate.py                 accuracy + cost + latency -> summary.csv
requirements.txt             core arms + judge
requirements-deepagents.txt  deepagents arm (separate venv)
Dockerfile                   core pipeline
.env.example                 all configuration
```

## Notes on fairness

- **One prompt, everywhere.** No arm gets task-specific hints or a different prompt.
- **No arm-specific model tuning.** Every agent runs its framework's default model
  settings — no extra reasoning-effort or output-length knobs on any arm. Per-arm
  retry / timeout / recursion values are each framework's sensible defaults.
- **Blind, strict judge.** Criteria only; no reference answers; all-or-nothing.
- **List-price cost.** Same formula for every arm, normalized for each framework's
  token reporting.
- **Dataset is DevRev's.** We point at their open release; we do not ship it.
- **We report trial means.** Single runs on these tasks are noisy; run multiple
  trials and compare distributions, not one cell.
