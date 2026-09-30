import { AsyncLocalStorage } from 'node:async_hooks';
import winston from 'winston';
import { newId } from '../utils/id';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Inbound ids are echoed into logs, so reject anything that is not a single token. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export interface LogContext {
  request_id: string;
  turn_id?: string;
}

/** Mutable so the turn id can be attached after the request id is chosen. */
const logContextStorage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return logContextStorage.run(context, fn);
}

/** Attach the turn id to the active store. No-ops outside a request or schedule handoff. */
export function bindLogContext(patch: { turn_id: string }): void {
  const current = logContextStorage.getStore();
  if (current === undefined) {
    return;
  }
  current.turn_id = patch.turn_id;
}

export function readLogContext(): LogContext | undefined {
  return logContextStorage.getStore();
}

/** Keep a caller-supplied request id when it is safe to put in a log line; otherwise mint one. */
export function resolveRequestId(header: string | undefined): string {
  if (header !== undefined && REQUEST_ID_PATTERN.test(header)) {
    return header;
  }
  return newId();
}

/** Copies the active log context onto each Winston record. */
export function logContextFormat(): winston.Logform.Format {
  return winston.format(info => {
    const context = logContextStorage.getStore();
    if (context === undefined) {
      return info;
    }
    info['request_id'] = context.request_id;
    if (context.turn_id !== undefined) {
      info['turn_id'] = context.turn_id;
    }
    return info;
  })();
}
