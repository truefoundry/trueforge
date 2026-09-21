/** ISO timestamp one year before now — used as `listSessions` `startTimestamp`. */
export function sessionListStartTimestamp(): string {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  return start.toISOString();
}
