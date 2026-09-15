import * as Sentry from '@sentry/node';

export { captureCriticalException } from './captureCriticalException';
export { initSentry, type InitSentryOptions } from './initSentry';

export const SENTRY_FLUSH_TIMEOUT_MS = 2000;

export async function flushSentry(timeoutMs: number = SENTRY_FLUSH_TIMEOUT_MS): Promise<void> {
  await Sentry.flush(timeoutMs);
}

export async function exitAfterFlushSentry(exitCode: number): Promise<never> {
  await flushSentry();
  process.exit(exitCode);
}
