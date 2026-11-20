import type { Decision, DecisionModelCreateParams } from '../decision/IDecisionModel';
import { estimateCharactersForTokens, estimateTokensForString } from '../llm/usage';
import type { RoutingQuestion } from './question';

const TRUNCATION_MARKER = '\n\n[…]\n\n';
/** Context window assumed when the catalog does not list the decision model's. */
const DEFAULT_CONTEXT_TOKENS = 64_000;

/** Keeps the start and the end of a long text, where its setup and its actual request usually are. */
function truncateMiddle(text: string, maxChars: number): string {
  const half = Math.floor((maxChars - TRUNCATION_MARKER.length) / 2);
  return `${text.slice(0, half)}${TRUNCATION_MARKER}${text.slice(-half)}`;
}

function fitTask(task: string, maxChars: number): string {
  return task.length > maxChars ? truncateMiddle(task, maxChars) : task;
}

/** The newest messages that fit in `maxChars`. The latest is always kept, and cut from the middle if it alone is too long. */
function fitConversation(messages: Exclude<DecisionModelCreateParams['input'], string>, maxChars: number) {
  const kept: typeof messages = [];
  let used = 0;
  let truncated = false;
  for (let index = messages.length - 1; index >= 0; index--) {
    let message = messages[index];
    if (message === undefined) {
      continue;
    }
    const size = JSON.stringify(message).length;
    if (kept.length > 0 && used + size > maxChars) {
      truncated = true;
      break;
    }
    if (kept.length === 0 && size > maxChars && 'content' in message && typeof message.content === 'string') {
      message = { ...message, content: truncateMiddle(message.content, maxChars) };
      truncated = true;
    }
    kept.unshift(message);
    used += size;
  }
  return truncated ? kept : messages;
}

export interface Classification {
  category: string;
  /** Logged with the routing decision. */
  details: Record<string, unknown>;
}

/**
 * The decision request for routing. Input is trimmed to the classifier's context window: a task keeps its start and
 * its end, and a conversation keeps its newest messages. `isTruncated` when anything was cut.
 */
export function classificationRequest(
  input: DecisionModelCreateParams['input'],
  question: RoutingQuestion,
  contextLength: number | undefined,
): { body: DecisionModelCreateParams; isTruncated: boolean } {
  const isTask = typeof input === 'string';
  const questions: DecisionModelCreateParams['questions'] = [
    {
      type: 'choice',
      name: 'category',
      instructions: isTask ? question.instructions : question.conversationInstructions,
      choices: Object.entries(question.categories).map(([value, description]) => ({ value, description })),
    },
  ];
  const maxChars = estimateCharactersForTokens(
    (contextLength ?? DEFAULT_CONTEXT_TOKENS) - estimateTokensForString(JSON.stringify(questions)),
  );
  const fitted = isTask ? fitTask(input, maxChars) : fitConversation(input, maxChars);
  return { body: { input: fitted, questions }, isTruncated: fitted !== input };
}

/** The category the decision model chose, or undefined when it gave none. */
export function readClassification(decision: Decision): Classification | undefined {
  const answer = decision.answers.find(candidate => candidate.name === 'category');
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string') {
    return undefined;
  }
  return {
    category: answer.choice,
    details: {
      confidence: answer.confidence,
      probabilities: [...answer.probabilities].sort((a, b) => b.probability - a.probability),
    },
  };
}
