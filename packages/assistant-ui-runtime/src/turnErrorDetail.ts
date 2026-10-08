import type { TurnStateError } from './server/types.js';

/**
 * What a failed turn puts on `MessageStatus.error`. assistant-ui types that field as `unknown`,
 * so this is the agreed shape both the writer (status mapping) and the reader (error banner) use.
 */
export interface TurnErrorDetail {
  readonly message: string;
  readonly code?: string;
  readonly source?: string;
  readonly retryable?: boolean;
  readonly detail?: string;
}

export function toTurnErrorDetail(state: TurnStateError): TurnErrorDetail {
  return {
    message: state.message,
    ...(state.code == null ? {} : { code: state.code }),
    ...(state.source == null ? {} : { source: state.source }),
    ...(state.retryable == null ? {} : { retryable: state.retryable }),
    ...(state.detail == null ? {} : { detail: state.detail }),
  };
}

function readString(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Reads back whatever was stored on `MessageStatus.error`. Older turns (and any host that still
 * writes a bare string) degrade to a message-only detail rather than rendering `[object Object]`.
 */
export function readTurnErrorDetail(value: unknown): TurnErrorDetail | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value === '' ? undefined : { message: value };
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  const message = readString(value, 'message');
  if (message === undefined) {
    return undefined;
  }
  const code = readString(value, 'code');
  const source = readString(value, 'source');
  const detail = readString(value, 'detail');
  const retryable: unknown = Reflect.get(value, 'retryable');
  return {
    message,
    ...(code === undefined ? {} : { code }),
    ...(source === undefined ? {} : { source }),
    ...(typeof retryable === 'boolean' ? { retryable } : {}),
    ...(detail === undefined ? {} : { detail }),
  };
}
