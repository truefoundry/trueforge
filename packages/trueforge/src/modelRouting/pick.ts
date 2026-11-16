export interface ScoredAnswer<T> {
  candidate: T;
  pYes: number;
  price?: number | undefined;
}

/** Highest yes-probability wins; ties go to the cheaper model, then to the earlier candidate. */
export function pickCandidate<T>(answers: readonly ScoredAnswer<T>[]): ScoredAnswer<T> | undefined {
  let best: ScoredAnswer<T> | undefined;
  for (const answer of answers) {
    if (
      best === undefined ||
      answer.pYes > best.pYes ||
      (answer.pYes === best.pYes && (answer.price ?? Infinity) < (best.price ?? Infinity))
    ) {
      best = answer;
    }
  }
  return best;
}
