export interface ScoredAnswer<T> {
  candidate: T;
  pYes: number;
  price?: number | undefined;
}

/** Higher yes-probability first; among equal probabilities, cheaper first, and an unpriced model last. */
function byPYesThenPrice<T>(a: ScoredAnswer<T>, b: ScoredAnswer<T>): number {
  const price = (answer: ScoredAnswer<T>) => answer.price ?? Number.MAX_VALUE;
  return b.pYes - a.pYes || price(a) - price(b);
}

/** The answer with the highest yes-probability; ties go to the cheapest model. Undefined when there are no answers. */
export function pickCandidate<T>(answers: readonly ScoredAnswer<T>[]): ScoredAnswer<T> | undefined {
  return [...answers].sort(byPYesThenPrice)[0];
}
