// Descriptions are quoted verbatim, retrieved 2026-11-16; don't paraphrase them. Sources:
// https://artificialanalysis.ai/methodology/intelligence-benchmarking (all but HLE), https://lastexam.ai/ (HLE).

/**
 * The nine evaluations in the Artificial Analysis Intelligence Index v5, the score routing uses.
 * Jev is asked which ones a task resembles; the answers are logged, never used to pick a model.
 */
export const RESEMBLANCE_BENCHMARKS: Readonly<Record<string, { readonly name: string; readonly description: string }>> =
  {
    briefcase: {
      name: 'AA-Briefcase',
      description:
        'AA-Briefcase is a new benchmark for testing models on realistic knowledge work tasks in complex projects built by industry experts. Models are evaluated on multi-week knowledge work projects, each with many linked tasks and thousands of input source files.',
    },
    automationbench: {
      name: 'AutomationBench',
      description:
        'It tests whether models can complete realistic SaaS workflows that span multiple simulated business apps, using REST APIs as the tool interface.',
    },
    gdp_pdf: {
      name: 'GDP.pdf',
      description:
        'A benchmark that tests whether models can reason over long, real-world professional documents and satisfy task-specific criteria.',
    },
    frontiercode: {
      name: 'FrontierCode',
      description:
        'Each task asks an agent to make a change to a real open-source repository, and the benchmark measures whether the change is good enough for a maintainer to merge.',
    },
    terminal_bench: {
      name: 'Terminal-Bench',
      description:
        'Covers software engineering, system administration, data processing, model training, and security, with each task graded by its own verification suite.',
    },
    terminal_bench_science: {
      name: 'Terminal-Bench-Science',
      description:
        'Its research workflow tasks are drawn from real scientific practice, and experts curate and review each one. Each task has its own set of tests that the agent must pass by working in a terminal.',
    },
    critpt: {
      name: 'CritPt',
      description:
        'Research-level physics reasoning benchmark with unpublished, frontier physics problems spanning a wide range of subfields.',
    },
    omniscience: {
      name: 'AA-Omniscience',
      description:
        'AA-Omniscience is a knowledge and hallucination benchmark that measures factual reliability, rewards precise knowledge, and penalizes incorrect guesses or hallucinations.',
    },
    hle: {
      name: "Humanity's Last Exam",
      description:
        "Humanity's Last Exam, a multi-modal benchmark at the frontier of human knowledge, designed to be the final closed-ended academic benchmark of its kind with broad subject coverage.",
    },
  };
