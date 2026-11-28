import type { ReasoningEffort } from '../llm/VercelAILLM';
import type { RoutingCategory } from './question';

/** Category -> effort -> canonical ids: every model and effort pair listed is good enough for that work. */
export type RoutingClusters = Record<RoutingCategory, Partial<Record<ReasoningEffort, readonly string[]>>>;

/**
 * The router picks the cheapest pair the tenant has, by its gateway cost per token, and the thread runs at that effort.
 * Nearest anchor by AA Intelligence Index v5.0.1 (Haiku 24.6, Sonnet 30.8, GPT-6.1 Sol 46.3 at medium); min 18/26/41.
 * `frontier` is min 54, above every `analytical` pair. Only the root thread routes to it;
 * subagents are never offered the category.
 */
export const ROUTING_CLUSTERS: RoutingClusters = {
  routine: {
    low: ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5', 'zai/glm-5-3', 'google/gemini-3-8-flash'],
    medium: ['openai/gpt-6-luna', 'anthropic/claude-haiku-5-5'],
    high: ['openai/gpt-6-luna'],
    xhigh: ['openai/gpt-6-luna', 'alibaba/qwen3-8-27b'],
  },
  guided: {
    low: ['openai/gpt-6-1-sol'],
    medium: ['anthropic/claude-sonnet-5-5', 'google/gemini-3-8-flash'],
    high: ['anthropic/claude-haiku-5-5', 'deepseek/deepseek-v4-1-flash', 'xai/grok-4-7', 'google/gemini-3-8-flash'],
    xhigh: ['anthropic/claude-haiku-5-5', 'xai/grok-4-6', 'xai/grok-4-7'],
    max: [
      'openai/gpt-6-luna',
      'anthropic/claude-haiku-5-5',
      'deepseek/deepseek-v4-1-flash',
      'meta/muse-spark-1-3',
      'zai/glm-5-3',
    ],
  },
  analytical: {
    medium: ['openai/gpt-6-1-sol'],
    high: ['openai/gpt-6-1-sol', 'anthropic/claude-sonnet-5-5', 'google/gemini-4-argon'],
    xhigh: ['openai/gpt-6-1-sol', 'anthropic/claude-sonnet-5-5'],
    max: ['openai/gpt-6-sol'],
  },
  frontier: {
    medium: ['google/gemini-4-carbon', 'anthropic/claude-fable-5-2'],
    high: ['anthropic/claude-fable-5-2'],
    xhigh: ['anthropic/claude-opus-5-5', 'anthropic/claude-fable-5-2'],
    max: [
      'anthropic/claude-fable-5-2',
      'google/gemini-4-carbon',
      'anthropic/claude-opus-5-5',
      'openai/gpt-6-1-sol',
      'anthropic/claude-sonnet-5-5',
    ],
  },
};
