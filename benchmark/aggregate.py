#!/usr/bin/env python3
"""Aggregate the matrix into per-harness accuracy, cost, and latency.

Reads results/matrix.jsonl (per-cell tokens/latency/tool-calls) and results/grades.jsonl
(per-cell PASS/FAIL), and writes results/summary.csv plus a printed table.

`Solved / 14` is the mean number of tasks passed per trial (each answer graded
all-or-nothing by the blind judge). Cost is computed per cell from token counts and
per-harness rates, then averaged per run.

    python aggregate.py

Token accounting differs by harness (see INPUT_IS_TOTAL): some report `input` as the
TOTAL prompt with cache reads/writes as a subset (uncached = input - cache_read -
cache_write); others report `input` as already-uncached. Rates are $/1M tokens; override
per harness with RATES / RATES_<HARNESS> env vars (see .env.example).
"""
import os, csv, json, pathlib
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
    all_rows = load("matrix.jsonl")                          # both "ok" and "failed" cells
    metrics = {(r["harness"], r["trial"], r["task"]): r for r in all_rows if r.get("status") == "ok"}
    verdicts = {(r["harness"], r["trial"], r["task"]): r["verdict"] for r in load("grades.jsonl")}

    harnesses = sorted({r["harness"] for r in all_rows})
    tasks = sorted({r["task"] for r in all_rows})
    total_tasks = len(tasks)

    # Seed every ATTEMPTED (harness, trial) to zero passes — including a trial whose cells
    # all hard-failed (no "ok" rows). Otherwise that trial would be absent and the mean
    # would divide by fewer trials, overstating accuracy after a full-trial failure.
    solved_per_trial = defaultdict(dict)                     # solved_per_trial[harness][trial] -> #tasks passed
    for r in all_rows:
        solved_per_trial[r["harness"]].setdefault(r["trial"], 0)
    for (h, tr, t), v in verdicts.items():
        if v == "PASS":
            solved_per_trial[h][tr] = solved_per_trial[h].get(tr, 0) + 1

    per_task = defaultdict(lambda: defaultdict(list))        # per_task[harness][task] -> [PASS/FAIL...]
    per_cell = defaultdict(lambda: {"cost": [], "lat": [], "tok": [], "tools": []})
    for (h, tr, t), m in metrics.items():
        per_task[h][t].append(verdicts.get((h, tr, t), "UNGRADED"))
        per_cell[h]["cost"].append(cell_cost(h, m["tokens"]))
        per_cell[h]["lat"].append(m.get("latency_s", 0))
        per_cell[h]["tok"].append(m["tokens"]["input"] + m["tokens"]["output"])
        per_cell[h]["tools"].append(m.get("tool_calls", 0))

    def mean(xs):
        return sum(xs) / len(xs) if xs else 0.0

    # summary.csv: per (harness, task) pass count across trials
    with open(OUT / "summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["harness", "task", "trials", "passes"])
        for h in harnesses:
            for t in tasks:
                vs = per_task[h].get(t, [])
                w.writerow([h, t, len(vs), sum(1 for v in vs if v == "PASS")])

    hdr = f"{'harness':22} {'n':>2} {'solved/'+str(total_tasks):>10} {'$/run':>8} {'tokens':>9} {'tools':>6} {'lat_s':>6}"
    print("\n" + hdr); print("-" * len(hdr))
    for h in harnesses:
        trials = solved_per_trial[h]
        solved = mean(list(trials.values()))                 # mean tasks passed per trial
        c = per_cell[h]
        print(f"{h:22} {len(trials):>2} {solved:>10.1f} "
              f"{'$'+format(mean(c['cost']),'.2f'):>8} {mean(c['tok'])/1e6:>8.2f}M "
              f"{mean(c['tools']):>6.1f} {mean(c['lat']):>6.0f}")
    print(f"\nwrote {OUT/'summary.csv'}")


if __name__ == "__main__":
    main()
