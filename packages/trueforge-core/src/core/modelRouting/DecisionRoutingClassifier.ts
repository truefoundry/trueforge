import type { IDecisionModel } from '../decision/IDecisionModel';
import type { IRoutingClassifier, RoutingClassification, RoutingState } from './IRoutingClassifier';
import { BENCHMARK_QUESTION, type RoutingQuestion } from './question';

/** Keeps the decision request under the gateway's body limit. */
const TASK_CHARS = 8_000;

/** Classifies a task with one call to a decision model: the category question, plus the logged-only benchmark one. */
export class DecisionRoutingClassifier implements IRoutingClassifier {
  readonly #decision: IDecisionModel;
  readonly #question: RoutingQuestion;

  constructor(input: { decision: IDecisionModel; question: RoutingQuestion }) {
    this.#decision = input.decision;
    this.#question = input.question;
  }

  async classify(state: RoutingState, signal: AbortSignal): Promise<RoutingClassification> {
    const task = state.instructions.slice(0, TASK_CHARS);
    const decision = await this.#decision.create(
      {
        input: state.name === undefined ? task : `Name: ${state.name}\n\nTask:\n${task}`,
        questions: [
          {
            type: 'choice',
            name: 'category',
            instructions: this.#question.instructions,
            choices: Object.entries(this.#question.categories).map(([value, description]) => ({ value, description })),
          },
          { type: 'choice', ...BENCHMARK_QUESTION },
        ],
      },
      { metadata: { 'tfg.thread_id': state.threadId }, signal },
    );
    const answer = decision.answers.find(candidate => candidate.name === 'category');
    if (answer?.type !== 'choice' || typeof answer.choice !== 'string') {
      throw new Error(`The decision model returned no category: ${JSON.stringify(answer)}`);
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
}
