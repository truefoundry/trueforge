import type { ThreadContextCompactionFinishedEvent, ThreadContextCompactionStartedEvent } from './server/index.js';

/** assistant-ui `data` part name for context compaction steps in the chat timeline. */
export const CONTEXT_COMPACTION_DATA_NAME = 'thread.context_compaction';

export type ContextCompactionPartData =
  | {
      status: 'running';
      started: ThreadContextCompactionStartedEvent;
    }
  | {
      status: 'complete';
      started: ThreadContextCompactionStartedEvent;
      finished: ThreadContextCompactionFinishedEvent;
    }
  | {
      status: 'incomplete';
      reason: 'cancelled' | 'error';
      started: ThreadContextCompactionStartedEvent;
    };

export function isContextCompactionPartData(value: unknown): value is ContextCompactionPartData {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  if (!('status' in value) || !('started' in value)) {
    return false;
  }
  const status = value.status;
  if (status === 'running' || status === 'complete') {
    return true;
  }
  if (status !== 'incomplete') {
    return false;
  }
  if (!('reason' in value)) {
    return false;
  }
  return value.reason === 'cancelled' || value.reason === 'error';
}
