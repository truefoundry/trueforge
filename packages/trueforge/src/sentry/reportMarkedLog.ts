import winston from 'winston';
import { captureCriticalException } from './captureCriticalException';

function readExtra(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    extra[key] = Reflect.get(value, key);
  }
  return extra;
}

function readReportableError(
  value: unknown,
): { error: unknown; operation: string; extra: Record<string, unknown> | undefined } | undefined {
  if (typeof value !== 'object' || value === null || !('operation' in value) || !('error' in value)) {
    return undefined;
  }
  const operation = Reflect.get(value, 'operation');
  if (typeof operation !== 'string' || operation.length === 0) {
    return undefined;
  }
  return {
    error: Reflect.get(value, 'error'),
    operation,
    extra: readExtra(Reflect.get(value, 'extra')),
  };
}

function toError(value: unknown): Error | undefined {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return new Error(value, { cause: value });
}

export function reportMarkedLogFormat(): winston.Logform.Format {
  return winston.format(info => {
    const marked = readReportableError(info['reportable_error']);
    if (marked !== undefined) {
      const error = toError(marked.error);
      if (error !== undefined) {
        captureCriticalException(error, {
          tags: { operation: marked.operation },
          ...(marked.extra !== undefined ? { extra: marked.extra } : {}),
        });
      }
    }
    Reflect.deleteProperty(info, 'reportable_error');
    return info;
  })();
}
