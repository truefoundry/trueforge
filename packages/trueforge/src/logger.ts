/**
 * Process logger: human-readable lines in standalone mode, JSON otherwise.
 * JSON output carries `component` ('server' | 'controller') in defaultMeta
 * so hosted aggregators can tell the two processes apart; it is omitted from the
 * human-readable standalone format to keep local logs terse.
 * In-flight work stamps `tenant_id`, `request_id`, `session_id`, and `turn_id` when known.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import winston, { type Logger } from 'winston';

const STANDALONE_META_SKIP = new Set(['level', 'message', 'timestamp', 'component', 'stack', 'splat']);

/** Ids copied onto each Winston line while the matching work is in progress. Absent keys are omitted. */
export interface LogContext {
  tenant_id?: string;
  request_id?: string;
  session_id?: string;
  turn_id?: string;
}

const LOG_CONTEXT_KEYS: (keyof LogContext)[] = ['tenant_id', 'request_id', 'session_id', 'turn_id'];

const logContextStorage = new AsyncLocalStorage<LogContext>();

function assignDefined(target: LogContext, fields: LogContext): void {
  for (const key of LOG_CONTEXT_KEYS) {
    const value = fields[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

/** Run `fn` with `fields` overlaid on the current ids. Nested calls keep parent ids they do not replace. */
export function runWithLogContext<T>(fields: LogContext, fn: () => T): T {
  const parent = logContextStorage.getStore();
  const next: LogContext = parent === undefined ? {} : { ...parent };
  assignDefined(next, fields);
  return logContextStorage.run(next, fn);
}

/** Merge `fields` into the current context. No-op outside {@link runWithLogContext}. */
export function updateLogContext(fields: LogContext): void {
  const store = logContextStorage.getStore();
  if (store === undefined) {
    return;
  }
  assignDefined(store, fields);
}

/** Current ids, or `undefined` when no request or turn context is active. */
export function currentLogContext(): LogContext | undefined {
  return logContextStorage.getStore();
}

/** Fill missing id keys from the active context. A field passed on the log call wins. */
function logContextFormat(): winston.Logform.Format {
  return winston.format(info => {
    const store = logContextStorage.getStore();
    if (store === undefined) {
      return info;
    }
    for (const key of LOG_CONTEXT_KEYS) {
      if (info[key] !== undefined) {
        continue;
      }
      const value = store[key];
      if (value !== undefined) {
        info[key] = value;
      }
    }
    return info;
  })();
}

export function shouldColorize(): boolean {
  const noColor = process.env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') {
    return false;
  }
  const forceColor = process.env['FORCE_COLOR'];
  if (forceColor === '0') {
    return false;
  }
  if (forceColor !== undefined && forceColor !== '') {
    return true;
  }
  return process.stderr.isTTY;
}

function standaloneMeta(info: object): string {
  const copied: Record<string, unknown> = { ...info };
  const meta: Record<string, unknown> = {};
  for (const key of Object.keys(copied)) {
    if (STANDALONE_META_SKIP.has(key)) {
      continue;
    }
    meta[key] = copied[key];
  }
  if (Object.keys(meta).length === 0) {
    return '';
  }
  return ` ${JSON.stringify(meta)}`;
}

function standaloneFormat(color: boolean): winston.Logform.Format {
  const parts: winston.Logform.Format[] = [
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    logContextFormat(),
  ];
  if (color) {
    parts.push(winston.format.colorize({ level: true }));
  }
  parts.push(
    winston.format.printf(info => {
      const extra = standaloneMeta(info);
      const stack = typeof info['stack'] === 'string' ? `\n${info['stack']}` : '';
      return `${String(info['timestamp'])} ${info.level} ${String(info.message)}${extra}${stack}`;
    }),
  );
  return winston.format.combine(...parts);
}

function jsonFormat(): winston.Logform.Format {
  return winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    logContextFormat(),
    winston.format.json(),
  );
}

function serverLogFormat(options: { standalone: boolean }): winston.Logform.Format {
  if (options.standalone) {
    return standaloneFormat(shouldColorize());
  }
  return jsonFormat();
}

function createLogger(options: { level: string; standalone: boolean; component: 'server' | 'controller' }): Logger {
  return winston.createLogger({
    level: options.level,
    defaultMeta: { component: options.component },
    format: serverLogFormat({ standalone: options.standalone }),
    transports: [new winston.transports.Console()],
  });
}

export function createServerLogger(options: { level: string; standalone: boolean }): Logger {
  return createLogger({ ...options, component: 'server' });
}

export function createControllerLogger(options: { level: string; standalone: boolean }): Logger {
  return createLogger({ ...options, component: 'controller' });
}
