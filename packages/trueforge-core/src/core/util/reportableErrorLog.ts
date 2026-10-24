import { readFileSync } from 'node:fs';
import { SourceMap, type SourceMapPayload, type SourceOrigin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReportableErrorLog {
  error: unknown;
  extra: Record<string, unknown> | undefined;
  filepath: string | undefined;
}

function isCallSite(value: unknown): value is NodeJS.CallSite {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getFileName' in value &&
    typeof Reflect.get(value, 'getFileName') === 'function'
  );
}

function withSlashes(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

/** Third-party frames. Published core and the server bundle stay, so the log site is not skipped. */
function isThirdPartyFrame(fileName: string): boolean {
  if (fileName.startsWith('node:')) {
    return true;
  }
  const normalized = withSlashes(fileName);
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index === -1) {
    return false;
  }
  const rest = normalized.slice(index + marker.length);
  return !rest.startsWith('@truefoundry/trueforge-core/') && !rest.startsWith('@truefoundry/trueforge/');
}

function filesystemPath(fileName: string): string {
  if (fileName.startsWith('file:')) {
    return fileURLToPath(fileName);
  }
  return fileName;
}

function packageRelativePath(fileName: string): string {
  const normalized = withSlashes(fileName);
  const packagesMarker = '/packages/';
  const packagesIndex = normalized.lastIndexOf(packagesMarker);
  if (packagesIndex !== -1) {
    return normalized.slice(packagesIndex + packagesMarker.length);
  }
  const scopedMarker = '/@truefoundry/';
  const scopedIndex = normalized.lastIndexOf(scopedMarker);
  if (scopedIndex !== -1) {
    return normalized.slice(scopedIndex + scopedMarker.length);
  }
  return normalized;
}

function isBundledEntry(fileName: string): boolean {
  return /\/dist\/(?:main|controller-main|cli)\.js$/.test(withSlashes(fileName));
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      return undefined;
    }
    items.push(item);
  }
  return items;
}

function readSourcesContent(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      items.push(item);
      continue;
    }
    if (item === null) {
      items.push('');
      continue;
    }
    return [];
  }
  return items;
}

function readSourceMapPayload(value: unknown): SourceMapPayload | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const version: unknown = Reflect.get(value, 'version');
  const sources = readStringArray(Reflect.get(value, 'sources'));
  const mappings: unknown = Reflect.get(value, 'mappings');
  const names = readStringArray(Reflect.get(value, 'names'));
  if (typeof version !== 'number' || sources === undefined || typeof mappings !== 'string' || names === undefined) {
    return undefined;
  }
  const file: unknown = Reflect.get(value, 'file');
  const sourceRoot: unknown = Reflect.get(value, 'sourceRoot');
  const sourcesContent: unknown = Reflect.get(value, 'sourcesContent');
  return {
    file: typeof file === 'string' ? file : 'generated.js',
    version,
    sources,
    sourcesContent: readSourcesContent(sourcesContent),
    names,
    mappings,
    sourceRoot: typeof sourceRoot === 'string' ? sourceRoot : '',
  };
}

const sourceMaps = new Map<string, SourceMap | undefined>();

function sourceMapFor(generatedPath: string): SourceMap | undefined {
  if (sourceMaps.has(generatedPath)) {
    return sourceMaps.get(generatedPath);
  }
  let map: SourceMap | undefined;
  try {
    const raw: unknown = JSON.parse(readFileSync(`${generatedPath}.map`, 'utf8'));
    const payload = readSourceMapPayload(raw);
    map = payload === undefined ? undefined : new SourceMap(payload);
  } catch {
    map = undefined;
  }
  sourceMaps.set(generatedPath, map);
  return map;
}

function originalFileName(origin: SourceOrigin | Record<string, never>): string | undefined {
  if (!('fileName' in origin)) {
    return undefined;
  }
  const fileName: unknown = origin.fileName;
  return typeof fileName === 'string' && fileName.length > 0 ? fileName : undefined;
}

/** Bundle frames are all `dist/main.js`. The sibling map names the file that logged. */
function originalSourceFile({
  generated,
  line,
  column,
}: {
  generated: string;
  line: number;
  column: number;
}): string | undefined {
  const generatedPath = filesystemPath(generated);
  const map = sourceMapFor(generatedPath);
  if (map === undefined) {
    return undefined;
  }
  const fileName = originalFileName(map.findOrigin(line, column));
  if (fileName === undefined) {
    return undefined;
  }
  if (fileName.startsWith('file:')) {
    return filesystemPath(fileName);
  }
  if (path.isAbsolute(fileName)) {
    return fileName;
  }
  return path.resolve(path.dirname(generatedPath), fileName);
}

function captureCallSites(): NodeJS.CallSite[] | undefined {
  const previous: unknown = Reflect.get(Error, 'prepareStackTrace');
  Reflect.set(Error, 'prepareStackTrace', (_error: Error, stack: NodeJS.CallSite[]) => stack);
  try {
    const captured = new Error();
    const stack: unknown = captured.stack;
    if (!Array.isArray(stack)) {
      return undefined;
    }
    return stack.filter(isCallSite);
  } finally {
    if (typeof previous === 'function') {
      Reflect.set(Error, 'prepareStackTrace', previous);
    } else {
      Reflect.deleteProperty(Error, 'prepareStackTrace');
    }
  }
}

function callerFilePath(): string | undefined {
  const sites = captureCallSites();
  if (sites === undefined) {
    return undefined;
  }
  for (const site of sites) {
    const generated = site.getFileName();
    if (generated === null || isThirdPartyFrame(generated)) {
      continue;
    }
    const line = site.getLineNumber();
    const column = site.getColumnNumber();
    const original = line !== null && column !== null ? originalSourceFile({ generated, line, column }) : undefined;
    const fileName = original ?? filesystemPath(generated);
    if (fileName.includes('reportableErrorLog') || isThirdPartyFrame(fileName)) {
      continue;
    }
    if (original === undefined && isBundledEntry(fileName)) {
      return line === null ? packageRelativePath(fileName) : `${packageRelativePath(fileName)}:${String(line)}`;
    }
    return packageRelativePath(fileName);
  }
  return undefined;
}

const markedErrors = new WeakSet<object>();

/** True when this error object was already attached to a Sentry log line. */
export function errorAlreadyMarked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && markedErrors.has(error);
}

/** Metadata the Sentry log format uses to report a Winston line. */
export function reportableErrorFields(input: { error: unknown; extra?: Record<string, unknown> }): {
  reportable_error: ReportableErrorLog;
} {
  if (typeof input.error === 'object' && input.error !== null) {
    markedErrors.add(input.error);
  }
  return {
    reportable_error: {
      error: input.error,
      extra: input.extra,
      filepath: callerFilePath(),
    },
  };
}
