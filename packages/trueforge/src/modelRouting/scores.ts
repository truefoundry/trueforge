import { MODEL_ROUTING_SCORES } from './modelRoutingScores';

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

type ScoreTable = Readonly<Record<string, { readonly name: string; readonly score: number }>>;

function variantSlug({ slug, effort }: { slug: string; effort: string }): string {
  return effort === 'none' ? `${slug}-non-reasoning` : `${slug}-${effort}`;
}

/**
 * Score for `slug` at `effort`: that exact variant, else the unlabelled slug, else the nearest
 * effort (ties go higher). Variants match exactly, never by prefix, so `claude-sonnet-5` never
 * reads `claude-sonnet-5-5-*`.
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
  const target = effort !== undefined && EFFORTS.includes(effort) ? effort : undefined;
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
  const from = EFFORTS.indexOf(target ?? 'medium');
  const byDistance = [...EFFORTS].sort((a, b) => {
    const distance = Math.abs(EFFORTS.indexOf(a) - from) - Math.abs(EFFORTS.indexOf(b) - from);
    return distance !== 0 ? distance : EFFORTS.indexOf(b) - EFFORTS.indexOf(a);
  });
  for (const candidate of byDistance) {
    const entry = scores[variantSlug({ slug, effort: candidate })];
    if (entry !== undefined) {
      return entry;
    }
  }
  return undefined;
}
