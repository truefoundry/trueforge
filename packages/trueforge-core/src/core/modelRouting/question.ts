export interface RoutingQuestion {
  instructions: string;
  categories: { direct: string; fixed_steps: string; adaptive: string };
}

export type RoutingCategory = keyof RoutingQuestion['categories'];

export const DEFAULT_ROUTING_QUESTION: RoutingQuestion = {
  instructions: 'Which category best describes what this task needs to be completed?',
  categories: {
    direct:
      'The answer follows directly from the task text and general knowledge, and the work is routine: no tool is needed and nothing has to be worked out carefully.',
    fixed_steps:
      'Needs tools, but the task spells out every action: one call or several independent ones, carried out as stated. Tool results are only passed along or reported, never used to decide what to do next.',
    adaptive:
      "What to do next depends on what earlier tool calls return: investigate, branch, retry or reconcile results, or plan an approach the task doesn't spell out. Also any task, with or without tools, whose result depends on careful expert reasoning, such as finding subtle faults or weighing trade-offs.",
  },
};

/** Logged only, never used to pick a model: over time, shows which public benchmark our tasks resemble. */
export const BENCHMARK_QUESTION = {
  name: 'benchmark',
  instructions: 'Which public benchmark is this task most similar to?',
  choices: [
    {
      value: 'automation_bench',
      description:
        "AutomationBench: multi-step workflows across apps through API tools: look things up, combine results, act on them. Example: when a support ticket is tagged urgent, look up the customer's plan and notify the account owner.",
    },
    {
      value: 'terminal_bench',
      description:
        'Terminal-Bench: multi-step technical tasks in a shell: run commands, inspect files and logs, fix or configure something. Example: find why the service fails to start from its logs and fix the config.',
    },
    {
      value: 'gdpval',
      description:
        'GDPval: knowledge-work deliverables (reports, analyses, plans) produced with tools. Example: from these project documents, write a one-page status report with risks and next steps.',
    },
    {
      value: 'aa_lcr',
      description:
        'AA-LCR: answer questions that need reasoning across long documents or large outputs. Example: from these three long reports, which risk do all of them mention and how does each address it?',
    },
    {
      value: 'hle',
      description:
        "Humanity's Last Exam: hard expert-level knowledge and reasoning questions with one correct answer. Example: a difficult graduate-level question in a technical field.",
    },
    { value: 'none', description: 'None of these benchmarks is close to this task.' },
  ],
};
