export interface ReportableErrorLog {
  error: unknown;
  operation: string;
  extra: Record<string, unknown> | undefined;
}

const markedReportableErrors = new WeakSet<object>();

function rememberMarkedError(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    markedReportableErrors.add(error);
  }
}

/** True when this value, or a `cause` beneath it, was already marked for Sentry. */
export function hasMarkedReportableError(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (markedReportableErrors.has(current)) {
      return true;
    }
    current = 'cause' in current ? Reflect.get(current, 'cause') : undefined;
  }
  return false;
}

/** Metadata the server logger uses to decide that a Winston line should be reported. */
export function reportableErrorFields(input: { error: unknown; operation: string; extra?: Record<string, unknown> }): {
  reportable_error: ReportableErrorLog;
} {
  rememberMarkedError(input.error);
  return {
    reportable_error: {
      error: input.error,
      operation: input.operation,
      extra: input.extra,
    },
  };
}
