import type { Decision, DecisionModelCreateParams } from '../decision/IDecisionModel';
import { BENCHMARK_QUESTION, type RoutingQuestion } from './question';

/** Keeps the decision request under the gateway's body limit. */
const TASK_CHARS = 8_000;
const TRUNCATION_MARKER = '\n\n[…]\n\n';

/** Keeps the start and the end of a long task, where its setup and its actual request usually are. */
function truncateMiddle(text: string): string {
  if (text.length <= TASK_CHARS) {
    return text;
  }
  const half = Math.floor((TASK_CHARS - TRUNCATION_MARKER.length) / 2);
  return `${text.slice(0, half)}${TRUNCATION_MARKER}${text.slice(-half)}`;
}

export interface Classification {
  category: string;
  /** Logged with the routing decision. */
  details: Record<string, unknown>;
}

/** The decision request for routing: the category question, plus the logged-only benchmark one. */
export function classificationRequest(
  input: DecisionModelCreateParams['input'],
  question: RoutingQuestion,
): DecisionModelCreateParams {
  return {
    input: typeof input === 'string' ? truncateMiddle(input) : input,
    questions: [
      {
        type: 'choice',
        name: 'category',
        instructions: question.instructions,
        choices: Object.entries(question.categories).map(([value, description]) => ({ value, description })),
      },
      { type: 'choice', ...BENCHMARK_QUESTION },
    ],
  };
}

/** The category the decision model chose, or undefined when it gave none. */
export function readClassification(decision: Decision): Classification | undefined {
  const answer = decision.answers.find(candidate => candidate.name === 'category');
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string') {
    return undefined;
  }
  const benchmark = decision.answers.find(candidate => candidate.name === BENCHMARK_QUESTION.name);
  // Lists, not objects: the JSON log format sorts object keys, which would lose the ranking.
  return {
    category: answer.choice,
    details: {
      confidence: answer.confidence,
      probabilities: [...answer.probabilities].sort((a, b) => b.probability - a.probability),
      ...(benchmark?.type === 'choice'
        ? {
            benchmark: benchmark.choice,
            benchmark_probabilities: [...benchmark.probabilities].sort((a, b) => b.probability - a.probability),
          }
        : {}),
    },
  };
}
