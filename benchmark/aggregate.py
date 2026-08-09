#!/usr/bin/env python3
"""Aggregate the matrix into per-harness accuracy, cost, and latency.

Reads results/matrix.jsonl (per-cell tokens/latency/tool-calls) and results/grades.jsonl
(per-cell PASS/FAIL), and writes results/summary.csv plus a printed table.

A task counts as SOLVED for a harness when it passes in the MAJORITY of its trials
(>= ceil(trials/2)). Cost is computed per cell from token counts and per-harness rates,
then averaged per run.

    python aggregate.py

Token accounting differs by harness (see INPUT_IS_TOTAL): some report `input` as the
TOTAL prompt with cache reads/writes as a subset (uncached = input - cache_read -
cache_write); others report `input` as already-uncached. Rates are $/1M tokens; override
per harness with RATES / RATES_<HARNESS> env vars (see .env.example).
"""
import os, csv, json, math, pathlib
from collections import defaultdict

BENCH = pathlib.Path(__file__).parent
OUT = pathlib.Path(os.environ.get("OUT_DIR", str(BENCH / "results")))

# True  -> `input` is the total prompt, cache_read/cache_write are a subset of it.
# False -> `input` already excludes cached tokens (cache_read/write are separate).
INPUT_IS_TOTAL = {"tfy": True, "deepagents": True, "cma": False}

DEFAULT_RATES = {"in": 5.0, "out": 25.0, "cache_read": 0.5, "cache_write": 6.25}  # $/1M (Opus 4.8)


def rates_for(harness):
    r = dict(DEFAULT_RATES)
    if os.environ.get("RATES"):
        r.update(json.loads(os.environ["RATES"]))
    key = f"RATES_{harness.upper()}"
    if os.environ.get(key):
        r.update(json.loads(os.environ[key]))
    return r


def cell_cost(harness, tk):
    r = rates_for(harness)
    cr, cw = tk.get("cache_read", 0), tk.get("cache_write", 0)
    uncached = (tk["input"] - cr - cw) if INPUT_IS_TOTAL.get(harness, True) else tk["input"]
    uncached = max(0, uncached)
    return (uncached * r["in"] + tk["output"] * r["out"] + cr * r["cache_read"] + cw * r["cache_write"]) / 1e6


def load(path):
    rows = []
    p = OUT / path
    if p.exists():
        rows = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    return rows


def main():
    metrics = {(r["harness"], r["trial"], r["task"]): r for r in load("matrix.jsonl") if r.get("status") == "ok"}
    verdicts = {(r["harness"], r["trial"], r["task"]): r["verdict"] for r in load("grades.jsonl")}

    harnesses = sorted({h for (h, _, _) in metrics})
    tasks = sorted({t for (_, _, t) in metrics})
    trials = sorted({tr for (_, tr, _) in metrics})
    ntr = len(trials) or 1
    need = math.ceil(ntr / 2)

    per_task = defaultdict(lambda: defaultdict(list))     # per_task[harness][task] -> [PASS/FAIL...]
    per_cell = defaultdict(lambda: {"cost": [], "lat": [], "tok": [], "tools": []})
    for (h, tr, t), m in metrics.items():
        v = verdicts.get((h, tr, t), "UNGRADED")
        per_task[h][t].append(v)
        per_cell[h]["cost"].append(cell_cost(h, m["tokens"]))
        per_cell[h]["lat"].append(m.get("latency_s", 0))
        per_cell[h]["tok"].append(m["tokens"]["input"] + m["tokens"]["output"])
        per_cell[h]["tools"].append(m.get("tool_calls", 0))

    def mean(xs):
        return sum(xs) / len(xs) if xs else 0.0

    # summary.csv: per (harness, task) pass fraction
    with open(OUT / "summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["harness", "task", "trials", "passes", "solved_majority"])
        for h in harnesses:
            for t in tasks:
                vs = per_task[h].get(t, [])
                passes = sum(1 for v in vs if v == "PASS")
                w.writerow([h, t, len(vs), passes, int(passes >= need)])

    print(f"\ntrials/harness = {ntr}  (solved = passes in >= {need} trials)\n")
    hdr = f"{'harness':14} {'solved/N':>9} {'$/run':>8} {'tokens':>9} {'tool_calls':>11} {'latency_s':>10}"
    print(hdr); print("-" * len(hdr))
    for h in harnesses:
        solved = sum(1 for t in tasks if sum(1 for v in per_task[h].get(t, []) if v == "PASS") >= need)
        c = per_cell[h]
        print(f"{h:14} {str(solved)+'/'+str(len(tasks)):>9} "
              f"{'$'+format(mean(c['cost']),'.2f'):>8} {mean(c['tok'])/1e6:>8.2f}M "
              f"{mean(c['tools']):>11.1f} {mean(c['lat']):>10.0f}")
    print(f"\nwrote {OUT/'summary.csv'}")


if __name__ == "__main__":
    main()
