export interface ReportableErrorLog {
  error: unknown;
  extra?: Record<string, unknown>;
  filepath?: string;
}
