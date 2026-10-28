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

function readFilePath(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('filepath' in value)) {
    return undefined;
  }
  const filepath = Reflect.get(value, 'filepath');
  if (typeof filepath !== 'string' || filepath.length === 0) {
    return undefined;
  }
  return filepath;
}

function readReportableError(
  value: unknown,
): { error: unknown; extra: Record<string, unknown> | undefined; filepath: string | undefined } | undefined {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return undefined;
  }
  return {
    error: Reflect.get(value, 'error'),
    extra: readExtra(Reflect.get(value, 'extra')),
    filepath: readFilePath(value),
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

/** Log message is the Sentry title. The thrown error stays the cause and supplies the stack frames. */
function errorWithLogTitle({ message, cause }: { message: string; cause: Error }): Error {
  const titled = new Error(message, { cause });
  const causeStack = cause.stack;
  if (causeStack === undefined) {
    titled.stack = `${titled.name}: ${message}`;
    return titled;
  }
  const frameStart = causeStack.indexOf('\n');
  const frames = frameStart === -1 ? '' : causeStack.slice(frameStart);
  titled.stack = `${titled.name}: ${message}${frames}`;
  return titled;
}

function reportedError({ message, cause }: { message: unknown; cause: Error }): Error {
  if (typeof message === 'string' && message.length > 0) {
    return errorWithLogTitle({ message, cause });
  }
  return cause;
}

export function reportMarkedLogFormat(): winston.Logform.Format {
  return winston.format(info => {
    const marked = readReportableError(info['reportable_error']);
    if (marked !== undefined) {
      const cause = toError(marked.error);
      if (cause !== undefined) {
        captureCriticalException(reportedError({ message: info.message, cause }), {
          ...(marked.filepath !== undefined ? { tags: { filepath: marked.filepath } } : {}),
          ...(marked.extra !== undefined ? { extra: marked.extra } : {}),
        });
      }
    }
    Reflect.deleteProperty(info, 'reportable_error');
    return info;
  })();
}
