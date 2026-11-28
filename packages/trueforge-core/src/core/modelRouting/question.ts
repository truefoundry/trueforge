export interface RoutingQuestion {
  categories: { routine: string; guided: string; analytical: string; frontier: string };
}

export type RoutingCategory = keyof RoutingQuestion['categories'];

/** What a subagent's delegated task can be classified as: never `frontier`. */
export const SUBAGENT_ROUTING_CATEGORIES: readonly RoutingCategory[] = ['routine', 'guided', 'analytical'];

/** What the root thread's conversation can be classified as. */
export const ROOT_ROUTING_CATEGORIES: readonly RoutingCategory[] = [...SUBAGENT_ROUTING_CATEGORIES, 'frontier'];

export const CONVERSATION_ROUTING_INSTRUCTIONS =
  'Given the conversation so far, which category best describes what the latest user message needs to be completed?';

export const TASK_ROUTING_INSTRUCTIONS = 'Which category best describes what this task needs to be completed?';

export const DEFAULT_ROUTING_QUESTION: RoutingQuestion = {
  categories: {
    routine:
      'The answer follows directly from the task text and general knowledge, and the work is routine: no tool is needed and nothing has to be worked out carefully.',
    guided:
      'Needs tools, but the task spells out every action: one call or several, carried out as stated, where no step depends on the result of a previous one. Tool results are only passed along or reported, never used to decide what to do next. If any stated step depends on an earlier result, use analytical instead.',
    analytical:
      "The work depends on intermediate results or on careful reasoning. This includes: tool calls where a later step depends on an earlier output (even if the steps are stated), investigating, debugging, retrying or reconciling conflicting results, planning an approach the task doesn't spell out, and no-tool tasks that need real analysis, such as finding subtle faults, weighing trade-offs, or non-trivial math and logic. This is the default when a task is more than routine but does not meet the frontier bar.",
    frontier:
      'Reserve for tasks that are both (a) genuinely hard, meaning multi-stage, open-ended or novel problems where the approach itself must be designed and weaker models are likely to fail, and (b) where subtle errors would be hard to detect or costly. Default to analytical when unsure. Long output, many tool calls, routine coding, or high stakes alone do not qualify.',
  },
};
