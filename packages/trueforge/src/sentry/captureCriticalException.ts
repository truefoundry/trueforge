import * as Sentry from '@sentry/node';
import { isTrueFoundryModeEnabled } from '../config';

export function captureCriticalException(
  err: unknown,
  options?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  Sentry.withScope(scope => {
    scope.setTags({
      ...(isTrueFoundryModeEnabled()
        ? {
            priority: 'p1',
            team: 'agent-team',
          }
        : {}),
      ...options?.tags,
    });
    if (options?.extra) {
      scope.setExtras(options.extra);
    }
    Sentry.captureException(err);
  });
}
