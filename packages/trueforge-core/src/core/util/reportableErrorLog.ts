export interface ReportableErrorLog {
  error: unknown;
  operation: string;
  extra: Record<string, unknown> | undefined;
}

/** Metadata the server logger uses to decide that a Winston line should be reported. */
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
