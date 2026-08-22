import type { z } from 'zod';

/** One `  - path: message` line per issue — the operator-facing startup-error format shared by config-file loaders. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map(issue => `  - ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('\n');
}
