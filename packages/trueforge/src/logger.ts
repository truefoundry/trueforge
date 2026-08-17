/**
 * Process logger: human-readable lines in standalone mode, JSON otherwise.
 * Both formats include `version` (defaultMeta) so hosted aggregators can filter.
 */
import winston, { type Logger } from 'winston';

const STANDALONE_META_SKIP = new Set(['level', 'message', 'timestamp', 'version', 'stack', 'splat']);

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
    winston.format.json(),
  );
}

function serverLogFormat(options: { standalone: boolean }): winston.Logform.Format {
  if (options.standalone) {
    return standaloneFormat(shouldColorize());
  }
  return jsonFormat();
}

export function createServerLogger(options: { level: string; standalone: boolean; version: string }): Logger {
  return winston.createLogger({
    level: options.level,
    defaultMeta: { version: options.version },
    format: serverLogFormat({ standalone: options.standalone }),
    transports: [new winston.transports.Console()],
  });
}
