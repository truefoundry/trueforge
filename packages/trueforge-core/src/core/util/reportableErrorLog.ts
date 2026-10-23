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

function packageRelativePath(fileName: string): string {
  const marker = '/packages/';
  const index = fileName.lastIndexOf(marker);
  if (index === -1) {
    return fileName;
  }
  return fileName.slice(index + marker.length);
}

function callerFilePath(): string | undefined {
  const previous: unknown = Reflect.get(Error, 'prepareStackTrace');
  Reflect.set(Error, 'prepareStackTrace', (_error: Error, stack: NodeJS.CallSite[]) => stack);
  try {
    const captured = new Error();
    const stack: unknown = captured.stack;
    if (!Array.isArray(stack)) {
      return undefined;
    }
    for (const site of stack) {
      if (!isCallSite(site)) {
        continue;
      }
      const fileName = site.getFileName();
      if (
        fileName === null ||
        fileName.startsWith('node:') ||
        fileName.includes('node_modules') ||
        fileName.includes('reportableErrorLog')
      ) {
        continue;
      }
      return packageRelativePath(fileName);
    }
    return undefined;
  } finally {
    if (typeof previous === 'function') {
      Reflect.set(Error, 'prepareStackTrace', previous);
    } else {
      Reflect.deleteProperty(Error, 'prepareStackTrace');
    }
  }
}

/** Metadata the Sentry log format uses to report a Winston line. */
export function reportableErrorFields(input: { error: unknown; extra?: Record<string, unknown> }): {
  reportable_error: ReportableErrorLog;
} {
  return {
    reportable_error: {
      error: input.error,
      extra: input.extra,
      filepath: callerFilePath(),
    },
  };
}
