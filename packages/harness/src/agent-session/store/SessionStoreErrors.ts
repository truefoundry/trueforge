import type { TerminalTurnState } from '../schemas/turn';

/** Store conflict (e.g. first-terminal-wins violation, concurrent createTurn). */
export abstract class SessionStoreConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionStoreConflictError';
  }
}

/** Store not-found (session or turn missing). */
export abstract class SessionStoreNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionStoreNotFoundError';
  }
}

/** Implementation bug or thread misuse — not mapped to 4xx by API handlers. */
export class SessionStoreInvariantError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionStoreInvariantError';
  }
}

export class SessionNotFoundError extends SessionStoreNotFoundError {
  readonly session_id: string;

  constructor(session_id: string) {
    super(`Session not found: ${session_id}`);
    this.name = 'SessionNotFoundError';
    this.session_id = session_id;
  }
}

export class TurnNotFoundError extends SessionStoreNotFoundError {
  readonly turn_id: string;

  constructor(turn_id: string) {
    super(`Turn not found: ${turn_id}`);
    this.name = 'TurnNotFoundError';
    this.turn_id = turn_id;
  }
}

export class SessionAlreadyExistsError extends SessionStoreConflictError {
  readonly session_id: string;

  constructor(session_id: string, options?: ErrorOptions) {
    super(`Session already exists: ${session_id}`, options);
    this.name = 'SessionAlreadyExistsError';
    this.session_id = session_id;
  }
}

export class TurnAlreadyExistsError extends SessionStoreConflictError {
  readonly turn_id: string;

  constructor(turn_id: string, options?: ErrorOptions) {
    super(`Turn already exists: ${turn_id}`, options);
    this.name = 'TurnAlreadyExistsError';
    this.turn_id = turn_id;
  }
}

export class PreviousTurnRunningError extends SessionStoreConflictError {
  readonly previous_turn_id: string;

  constructor(previous_turn_id: string) {
    super(
      `Previous turn ${previous_turn_id} is still running; freezeAndGetTurn must be called before creating a successor`,
    );
    this.name = 'PreviousTurnRunningError';
    this.previous_turn_id = previous_turn_id;
  }
}

export class TurnNotRunningError extends SessionStoreConflictError {
  readonly turn_id: string;
  readonly state: TerminalTurnState;

  constructor(turn_id: string, state: TerminalTurnState) {
    super(`Turn ${turn_id} is not running (${state.status})`);
    this.name = 'TurnNotRunningError';
    this.turn_id = turn_id;
    this.state = state;
  }
}

export class InvalidPageTokenError extends SessionStoreConflictError {
  readonly token: string;

  constructor(token: string) {
    super(`Invalid page token: ${token}`);
    this.name = 'InvalidPageTokenError';
    this.token = token;
  }
}
