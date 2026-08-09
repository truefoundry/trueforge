#!/usr/bin/env python3
"""Blind LLM judge.

Grades every captured answer against its task's required criteria. The judge sees
ONLY the criteria and the answer — never the reference values, never which harness
produced the answer. A task is PASS only if every required criterion is satisfied
(no partial credit). Resumable: rerun to grade any answers not yet graded.

    python judge.py

Config (see .env.example): ANTHROPIC_API_KEY, JUDGE_MODEL (default claude-opus-4-8),
OUT_DIR, DATASET_DIR.
"""
import os, re, json, time, pathlib
import anthropic

BENCH = pathlib.Path(__file__).parent
OUT = pathlib.Path(os.environ.get("OUT_DIR", str(BENCH / "results")))
DATASET_DIR = pathlib.Path(os.environ.get("DATASET_DIR", str(BENCH / "dataset")))
GRADES = OUT / "grades.jsonl"
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "claude-opus-4-8")

# Criteria-only rubric. No reference answers, no per-task hints — the judge reasons
# from the criteria alone so the grade reflects the answer, not a leaked key.
SYSTEM = (
    "You grade a benchmark answer against its REQUIRED criteria. ALL required criteria "
    "must be satisfied to PASS; be strict and do not award partial credit. Work through "
    "each required criterion briefly against the answer, then end with a final line that "
    "is EXACTLY 'VERDICT: PASS' or 'VERDICT: FAIL'."
)

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def grade(criteria, answer):
    for attempt in range(5):
        try:
            msg = client.messages.create(
                model=JUDGE_MODEL, max_tokens=4000, system=SYSTEM,
                messages=[{"role": "user",
                           "content": f"REQUIRED CRITERIA:\n{criteria}\n\nANSWER:\n{answer[:60000]}"}])
            txt = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
            m = re.findall(r"VERDICT:\s*(PASS|FAIL)", txt, re.I) or re.findall(r"\b(PASS|FAIL)\b", txt, re.I)
            return (m[-1].upper() if m else "UNKNOWN")
        except Exception as e:
            last = e; time.sleep(5 * (attempt + 1))
    raise last


def criteria_for(task):
    return (DATASET_DIR / task / "tests" / "criteria.yaml").read_text()


def main():
    done = set()
    if GRADES.exists():
        for line in GRADES.read_text().splitlines():
            if line.strip():
                r = json.loads(line); done.add((r["harness"], r["trial"], r["task"]))
    answers = sorted(OUT.glob("*/t*/*.md"))
    with open(GRADES, "a") as out:
        for p in answers:
            task = p.stem
            trial = int(p.parent.name[1:])            # t1 -> 1
            harness = p.parent.parent.name
            if (harness, trial, task) in done:
                continue
            if not (DATASET_DIR / task / "tests" / "criteria.yaml").exists():
                print(f"skip {harness} t{trial} {task}: no criteria", flush=True); continue
            v = grade(criteria_for(task), p.read_text())
            out.write(json.dumps({"harness": harness, "trial": trial, "task": task, "verdict": v}) + "\n")
            out.flush()
            print(f"{harness} t{trial} {task}: {v}", flush=True)
    print("[judge] done", flush=True)


if __name__ == "__main__":
    main()
