import type { RouteModelInput, RouteModelResult } from '@truefoundry/trueforge-core/agent-session';
import { describeUnknownError } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import { RESEMBLANCE_BENCHMARKS } from './benchmarks';
import { pickCandidate } from './pick';
import { lookupScore } from './scores';
import type { DecisionClient, DecisionQuestion, RoutingCandidate } from './types';

const TASK_CHARS = 8_000;

const SCORE_NOTE =
  'Artificial Analysis Intelligence Index (0-100, higher is better) averages agentic knowledge work, coding, science and general reasoning evaluations.';

const CAN_COMPLETE: DecisionQuestion['criteria'] = {
  true: 'It would produce a result that can be used as-is: complete, accurate, and with the needed tool use done.',
  false: 'It would likely miss parts, make errors, or stop before the task is done.',
};

const RESEMBLES: DecisionQuestion['criteria'] = {
  true: 'Same kind of work as the benchmark.',
  false: 'A different kind of work.',
};

interface ScoredCandidate extends RoutingCandidate {
  name: string;
  score: number;
}

type FallbackReason = 'no_candidates' | 'decision_error' | 'decision_timeout';

function clip(text: string): string {
  if (text.length <= TASK_CHARS) {
    return text;
  }
  const half = TASK_CHARS / 2;
  return `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

function accountOf(model: string): string {
  return model.split('/', 1)[0] ?? model;
}

/** One candidate per scored slug, preferring the fallback model's account, capped by score. */
function scoredCandidates(input: {
  models: readonly RoutingCandidate[];
  fallbackModel: string;
  maxCandidates: number;
}): ScoredCandidate[] {
  const fallbackAccount = accountOf(input.fallbackModel);
  const bySlug = new Map<string, ScoredCandidate>();
  const ordered = [...input.models].sort((a, b) => {
    const preferred = Number(accountOf(b.model) === fallbackAccount) - Number(accountOf(a.model) === fallbackAccount);
    return preferred !== 0 ? preferred : a.model.localeCompare(b.model);
  });
  for (const model of ordered) {
    if (model.slug === undefined || bySlug.has(model.slug)) {
      continue;
    }
    const scored = lookupScore({ slug: model.slug, effort: model.defaultEffort });
    if (scored !== undefined) {
      bySlug.set(model.slug, { ...model, ...scored });
    }
  }
  return [...bySlug.values()].sort((a, b) => b.score - a.score).slice(0, input.maxCandidates);
}

function questions(candidates: readonly ScoredCandidate[]): Record<string, DecisionQuestion> {
  const out: Record<string, DecisionQuestion> = {};
  candidates.forEach((candidate, index) => {
    const effort = candidate.defaultEffort ?? 'its default';
    out[`can_${String(index)}`] = {
      instructions: `Can ${candidate.name} at ${effort} effort (Intelligence Index ${String(candidate.score)}) complete this task fully and correctly?`,
      criteria: CAN_COMPLETE,
    };
  });
  for (const [key, benchmark] of Object.entries(RESEMBLANCE_BENCHMARKS)) {
    out[`resembles_${key}`] = {
      instructions: `Does this task resemble the benchmark ${benchmark.name}? ${benchmark.description}`,
      criteria: RESEMBLES,
    };
  }
  return out;
}

function priceDirection(input: { picked?: number | undefined; fallback?: number | undefined }) {
  if (input.picked === undefined || input.fallback === undefined) {
    return undefined;
  }
  return input.picked > input.fallback ? 'up' : input.picked < input.fallback ? 'down' : 'same';
}

/**
 * `routeModel` for one turn. Candidates are listed once and shared by the turn's subagents.
 * Shadow mode logs the pick and keeps the fallback. Never throws.
 */
export function createModelRouter(input: {
  mode: 'shadow' | 'on';
  /** The caller's models; called once per turn. */
  listCandidates: () => Promise<RoutingCandidate[]>;
  decision: DecisionClient;
  timeoutMs: number;
  maxCandidates: number;
  logger: Logger;
}): (route: RouteModelInput) => Promise<RouteModelResult> {
  let models: Promise<RoutingCandidate[]> | undefined;

  return async route => {
    const startedMs = Date.now();
    const log = (fields: Record<string, unknown>) => {
      input.logger.info('model routing', {
        thread_id: route.threadId,
        mode: input.mode,
        fallback_model: route.fallbackModel,
        latency_ms: Date.now() - startedMs,
        ...fields,
      });
    };
    const fallback = (reason: FallbackReason, extra: Record<string, unknown> = {}): RouteModelResult => {
      log({ reason, chosen_model: route.fallbackModel, ...extra });
      return {};
    };

    const decide = async (timeout: AbortSignal): Promise<RouteModelResult> => {
      models ??= input.listCandidates().catch((error: unknown) => {
        models = undefined;
        throw error;
      });
      const all = await models;
      timeout.throwIfAborted();
      const candidates = scoredCandidates({
        models: all,
        fallbackModel: route.fallbackModel,
        maxCandidates: input.maxCandidates,
      });
      if (candidates.length === 0) {
        return fallback('no_candidates');
      }
      const answers = await input.decision.ask({
        threadId: route.threadId,
        state: {
          name: route.task.name,
          task: clip(route.task.instructions),
          tools: route.task.tools,
          benchmark_note: SCORE_NOTE,
        },
        questions: questions(candidates),
        signal: AbortSignal.any([route.signal, timeout]),
      });
      timeout.throwIfAborted();
      const picked = pickCandidate(
        candidates.flatMap((candidate, index) => {
          const pYes = answers[`can_${String(index)}`];
          return pYes === undefined ? [] : [{ candidate, pYes, price: candidate.price }];
        }),
      );
      if (picked === undefined) {
        return fallback('decision_error', { candidate_count: candidates.length });
      }
      const fallbackPrice = all.find(model => model.model === route.fallbackModel)?.price;
      const chosen = input.mode === 'on' ? picked.candidate.model : route.fallbackModel;
      log({
        reason: 'picked',
        picked_model: picked.candidate.model,
        chosen_model: chosen,
        picked_p_yes: picked.pYes,
        picked_price: picked.candidate.price,
        fallback_price: fallbackPrice,
        price_direction: priceDirection({ picked: picked.candidate.price, fallback: fallbackPrice }),
        picked_image_input: picked.candidate.imageInput,
        candidate_count: candidates.length,
        candidates: Object.fromEntries(
          candidates
            .map((candidate, index) => [candidate.model, answers[`can_${String(index)}`]] as const)
            .sort(([, a], [, b]) => (b ?? -1) - (a ?? -1)),
        ),
      });
      return input.mode === 'on' ? { model: picked.candidate.model } : {};
    };

    // The budget covers the whole step, including candidate listing and gateway lookups, not just the Jev call.
    const timeout = AbortSignal.timeout(input.timeoutMs);
    const timedOut = new Promise<never>((_, reject) => {
      timeout.addEventListener(
        'abort',
        () => {
          reject(new Error(`Routing timed out after ${String(input.timeoutMs)} ms`, { cause: timeout.reason }));
        },
        { once: true },
      );
    });
    const work = decide(timeout);
    // Whichever promise loses the race settles later; its outcome is already reported.
    work.catch(() => undefined);
    timedOut.catch(() => undefined);
    try {
      return await Promise.race([work, timedOut]);
    } catch (error) {
      return fallback(timeout.aborted ? 'decision_timeout' : 'decision_error', { err: describeUnknownError(error) });
    }
  };
}
