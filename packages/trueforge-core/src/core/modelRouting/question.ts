export interface RoutingQuestion {
  categories: { direct: string; fixed_steps: string; adaptive: string; frontier: string };
}

export type RoutingCategory = keyof RoutingQuestion['categories'];

/** What a subagent's delegated task can be classified as: never `frontier`. */
export const SUBAGENT_ROUTING_CATEGORIES: readonly RoutingCategory[] = ['direct', 'fixed_steps', 'adaptive'];

/** What the root thread's conversation can be classified as. */
export const ROOT_ROUTING_CATEGORIES: readonly RoutingCategory[] = [...SUBAGENT_ROUTING_CATEGORIES, 'frontier'];

export const CONVERSATION_ROUTING_INSTRUCTIONS =
  'Given the conversation so far, which category best describes what the latest user message needs to be completed?';

export const TASK_ROUTING_INSTRUCTIONS = 'Which category best describes what this task needs to be completed?';

export const DEFAULT_ROUTING_QUESTION: RoutingQuestion = {
  categories: {
    direct:
      'The answer follows directly from the task text and general knowledge, and the work is routine: no tool is needed and nothing has to be worked out carefully.',
    fixed_steps:
      'Needs tools, but the task spells out every action: one call or several independent ones, carried out as stated. Tool results are only passed along or reported, never used to decide what to do next.',
    adaptive:
      "What to do next depends on what earlier tool calls return: investigate, branch, retry or reconcile results, or plan an approach the task doesn't spell out. Also any task, with or without tools, whose result depends on careful expert reasoning, such as finding subtle faults or weighing trade-offs.",
    frontier:
      'Needs the strongest model available: a long, open-ended or high-stakes task where many dependent steps, deep expert judgement or novel problem-solving are required, and a mistake would be costly or hard to notice. Not just long output, many tools, or coding; prefer adaptive unless the task clearly goes beyond careful investigation or reasoning.',
  },
};
