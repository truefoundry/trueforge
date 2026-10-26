import type { ThreadContextCompactionFinishedEvent, ThreadContextCompactionStartedEvent } from './server/index.js';

/** assistant-ui `data` part name for context compaction steps in the chat timeline. */
export const CONTEXT_COMPACTION_DATA_NAME = 'thread.context_compaction';

export interface ContextCompactionPartData {
  status: 'running' | 'complete';
  started: ThreadContextCompactionStartedEvent;
  finished?: ThreadContextCompactionFinishedEvent;
}

export function isContextCompactionPartData(value: unknown): value is ContextCompactionPartData {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  if (!('status' in value) || !('started' in value)) {
    return false;
  }
  const status = value.status;
  return status === 'running' || status === 'complete';
}
