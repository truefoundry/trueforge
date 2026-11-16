import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/trueforge-core/core';
import { MODEL_ROUTING_SCORES } from './modelRoutingScores';

type Effort = (typeof SUPPORTED_REASONING_EFFORTS)[number];

type ScoreTable = Readonly<Record<string, { readonly name: string; readonly score: number }>>;

const EFFORTS: readonly string[] = SUPPORTED_REASONING_EFFORTS;

function isEffort(value: string | undefined): value is Effort {
  return value !== undefined && EFFORTS.includes(value);
}

/** Artificial Analysis publishes each effort as its own slug: `<slug>-high`, and `<slug>-non-reasoning` for `none`. */
function variantSlug({ slug, effort }: { slug: string; effort: Effort }): string {
  return effort === 'none' ? `${slug}-non-reasoning` : `${slug}-${effort}`;
}

/** Efforts ordered by closeness to `target`; of two equally close, the higher effort comes first. */
function effortsNearest(target: Effort): Effort[] {
  const rank = (effort: Effort) => SUPPORTED_REASONING_EFFORTS.indexOf(effort);
  const distance = (effort: Effort) => Math.abs(rank(effort) - rank(target));
  return [...SUPPORTED_REASONING_EFFORTS].sort((a, b) => distance(a) - distance(b) || rank(b) - rank(a));
}

/**
 * The Intelligence Index for a model running at `effort`. Tries, in order: the exact effort variant
 * (`<slug>-high`); the model's unlabelled score, which Artificial Analysis publishes at max effort; and the
 * closest effort that has a score (from medium when `effort` is unknown). Slugs match exactly, so a model never
 * picks up scores of a longer slug that starts with its own (`claude-sonnet-5` vs `claude-sonnet-5-5`).
 */
export function lookupScore({
  slug,
  effort,
  scores = MODEL_ROUTING_SCORES.scores,
}: {
  slug: string;
  effort: string | undefined;
  scores?: ScoreTable;
}): { name: string; score: number } | undefined {
  const target = isEffort(effort) ? effort : undefined;
  if (target !== undefined) {
    const exact = scores[variantSlug({ slug, effort: target })];
    if (exact !== undefined) {
      return exact;
    }
  }
  const unlabelled = scores[slug];
  if (unlabelled !== undefined) {
    return unlabelled;
  }
  for (const nearby of effortsNearest(target ?? 'medium')) {
    const entry = scores[variantSlug({ slug, effort: nearby })];
    if (entry !== undefined) {
      return entry;
    }
  }
  return undefined;
}
