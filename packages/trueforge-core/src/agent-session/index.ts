/**
 * Public agent session middle library.
 * Zod product contracts and session/turn runtime.
 */

export { AgentSpecSchema, DEFAULT_AGENT_CONFIG_ITERATION_LIMIT, RuntimeConfigSchema } from './schemas/agentSpec';
export type { AgentSpec, Skill } from './schemas/agentSpec';

export {
  CancellationReason,
  CreateTurnRequestSchema,
  TurnInputItemSchema,
  TurnMetricsSchema,
  TurnSchema,
  TurnStateCancelledReasonSchema,
  TurnStateCancelledSchema,
  TurnStateDoneSchema,
  TurnStateErrorSchema,
  TurnStateRunningSchema,
  TurnStateSchema,
} from './schemas/turn';
export type { TerminalTurnState, Turn, TurnInputItem, TurnMetrics, TurnState } from './schemas/turn';

export { SessionMetadataSchema, SessionMetricsSchema, SessionSchema } from './schemas/session';
export type { Session, SessionAgent, SessionMetadata, SessionMetrics } from './schemas/session';

export { CreatedBySubjectSchema, SubjectTypeSchema, parseStoredCreatedBySubject } from './schemas/subject';
export type { CreatedBySubject, SubjectType } from './schemas/subject';

export {
  EventType,
  SessionEventItemSchema,
  SessionEventSchema,
  TurnCreatedEventSchema,
  TurnDoneEventSchema,
} from './schemas/events';
export type {
  PersistedTurnEvent,
  SessionEvent,
  SessionEventItem,
  TurnCreatedEvent,
  TurnDoneEvent,
} from './schemas/events';

export { TokenPaginationSchema } from './schemas/pagination';
export type { TokenPagination } from './schemas/pagination';

export type { SessionRecord } from './models/SessionRecord';
export { MAIN_THREAD_ID } from './models/TurnRecord';
export type { TurnRecord, TurnSnapshot } from './models/TurnRecord';

export { assertCreateTurnThreadDelta } from './store/assertCreateTurnThreadDelta';
export { InMemorySessionStore } from './store/InMemorySessionStore';
export type {
  AddThreadsInput,
  AppendToEventsInput,
  AppendToThreadContextInput,
  CreateSessionInput,
  CreateTurnInput,
  DeleteSessionInput,
  FreezeAndGetTurnInput,
  GetSessionByExternalIdInput,
  GetSessionInput,
  GetTurnInput,
  ISessionStore,
  ListSessionEventsInput,
  ListSessionsInput,
  ListTurnEventsInput,
  ListTurnsInput,
  NewThreadInit,
  OverwriteThreadContextInput,
  PatchMCPServersInput,
  PatchSandboxInfoInput,
  PatchThreadCapabilityStateInput,
  RemoveThreadsInput,
  TurnContextAppend,
  TurnRecordWithoutSnapshot,
  UpdateSessionInput,
  UpdateTurnStateInput,
} from './store/ISessionStore';
export {
  InvalidPageTokenError,
  PreviousTurnRunningError,
  SessionAlreadyExistsError,
  SessionExternalIdConflictError,
  SessionNotFoundError,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  SessionStoreNotFoundError,
  TurnAlreadyExistsError,
  TurnNotFoundError,
  TurnNotRunningError,
} from './store/SessionStoreErrors';

export type { ITurnResourceResolver } from './ITurnResourceResolver';
export { TurnResourceResolver } from './TurnResourceResolver';
export type { TurnSandboxFactory } from './TurnResourceResolver';

export { SessionHandle } from './SessionHandle';
export { Sessions } from './Sessions';
export { TurnHandle } from './TurnHandle';
export type { TurnStreamingEvent } from './TurnHandle';
