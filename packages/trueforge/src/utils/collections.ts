export function firstDuplicate<T>(values: readonly T[]): T | undefined {
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

export function firstValueInSet<T>(values: readonly T[], candidates: ReadonlySet<T>): T | undefined {
  return values.find(value => candidates.has(value));
}
