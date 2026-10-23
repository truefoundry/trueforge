export interface ReportableErrorLog {
  error: unknown;
  operation: string;
  extra: Record<string, unknown> | undefined;
}

/** Metadata the Sentry log format uses to report a Winston line. */
export function reportableErrorFields(input: { error: unknown; operation: string; extra?: Record<string, unknown> }): {
  reportable_error: ReportableErrorLog;
} {
  return {
    reportable_error: {
      error: input.error,
      operation: input.operation,
      extra: input.extra,
    },
  };
}
