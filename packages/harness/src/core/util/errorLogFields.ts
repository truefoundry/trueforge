export interface ErrorLogFields {
  error: string;
  stack?: string | undefined;
}

function formatObjectErrorForLog(error: object): string {
  try {
    return JSON.stringify(error);
  } catch {
    return `unserialisable error (${Object.keys(error).join(', ')})`;
  }
}

/**
 * User/turn-facing message for any thrown value. Prefer Error.message / `.message`;
 * never surface developer-only strings (e.g. unserialisable dumps) in Agent Steps.
 */
export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : 'An unexpected error occurred';
  }
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }
  const message: unknown = Reflect.get(error, 'message');
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'An unexpected error occurred';
  }
}

export function extractErrorLogFields(error: unknown): ErrorLogFields {
  if (error instanceof Error) {
    return {
      error: error.message.length > 0 ? error.message : formatObjectErrorForLog(error),
      stack: error.stack,
    };
  }
  if (typeof error !== 'object' || error === null) {
    return { error: String(error) };
  }
  const message: unknown = Reflect.get(error, 'message');
  if (typeof message === 'string' && message.length > 0) {
    return { error: message };
  }
  return { error: formatObjectErrorForLog(error) };
}
