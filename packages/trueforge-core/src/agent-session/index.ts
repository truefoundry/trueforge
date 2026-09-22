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

export { TurnInboundEventItemSchema } from './schemas/sendEvent';
export type { TurnInboundEventItem } from './schemas/sendEvent';

export {
  SessionMetadataSchema,
  SessionMetricsSchema,
  SessionSchema,
  SessionSourceScheduleSchema,
  SessionSourceSchema,
  SessionSourceTypeSchema,
} from './schemas/session';
export type {
  Session,
  SessionAgent,
  SessionMetadata,
  SessionMetrics,
  SessionSource,
  SessionSourceType,
} from './schemas/session';

export { CreatedBySubjectSchema } from './schemas/subject';
export type { CreatedBySubject } from './schemas/subject';

export {
  EventType,
  SessionEventItemSchema,
  SessionEventSchema,
  TurnCreatedEventSchema,
  TurnDoneEventSchema,
  TurnUpdateEventSchema,
} from './schemas/events';
export type {
  PersistedTurnEvent,
  SessionEvent,
  SessionEventItem,
  TurnCreatedEvent,
  TurnDoneEvent,
  TurnUpdateEvent,
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
  GetOwnedIdsInput,
  GetSessionByExternalIdInput,
  GetSessionInput,
  GetTurnInput,
  ISessionStore,
  InsertTurnInboundEventsInput,
  ListSessionEventsInput,
  ListSessionsInput,
  ListTurnEventsInput,
  ListTurnsInput,
  ListUnconsumedTurnInboundEventsInput,
  MarkTurnInboundEventsConsumedInput,
  NewThreadInit,
  OverwriteThreadContextInput,
  PatchMCPServersInput,
  PatchSandboxInfoInput,
  PatchThreadCapabilityStateInput,
  RemoveThreadsInput,
  TurnContextAppend,
  TurnInboundEventRecord,
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
  TurnEventAlreadyExistsError,
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
