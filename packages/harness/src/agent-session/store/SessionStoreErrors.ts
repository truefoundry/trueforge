/** Store conflict (e.g. first-terminal-wins violation, concurrent createTurn). */
export class SessionStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionStoreConflictError';
  }
}

/** Store not-found (session or turn missing). */
export class SessionStoreNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionStoreNotFoundError';
  }
}
