import * as Sentry from '@sentry/node';

export function captureCriticalException(
  err: unknown,
  options?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  Sentry.withScope(scope => {
    if (options?.tags) {
      scope.setTags(options.tags);
    }
    if (options?.extra) {
      scope.setExtras(options.extra);
    }
    Sentry.captureException(err);
  });
}
