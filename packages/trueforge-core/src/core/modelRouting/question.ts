export interface RoutingQuestion {
  /** Asked about either input: a single task, or the latest user message of a conversation. */
  instructions: string;
  categories: { direct: string; fixed_steps: string; adaptive: string };
}

export type RoutingCategory = keyof RoutingQuestion['categories'];

export const DEFAULT_ROUTING_QUESTION: RoutingQuestion = {
  instructions:
    'Which category best describes what this task, or the latest user message of a conversation, needs to be completed?',
  categories: {
    direct:
      'The answer follows directly from the task text and general knowledge, and the work is routine: no tool is needed and nothing has to be worked out carefully.',
    fixed_steps:
      'Needs tools, but the task spells out every action: one call or several independent ones, carried out as stated. Tool results are only passed along or reported, never used to decide what to do next.',
    adaptive:
      "What to do next depends on what earlier tool calls return: investigate, branch, retry or reconcile results, or plan an approach the task doesn't spell out. Also any task, with or without tools, whose result depends on careful expert reasoning, such as finding subtle faults or weighing trade-offs.",
  },
};
