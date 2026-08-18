function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

const LITERAL_ESCAPE_PATTERN = /\\(?:[nrtbfv0'"\\]|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})/; // literal escape sequences like \n, \t, \b, \f, \v, \uXXXX, \xHH
const REAL_CONTROL_PATTERN = /[\n\t\b\f\v]/; // real control characters like \n, \t, \b, \f, \v

function decodeLiteralEscapes(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== '\\' || i + 1 >= text.length) {
      out += char;
      continue;
    }

    const next = text[i + 1];
    switch (next) {
      case 'n':
        out += '\n';
        i += 1;
        break;
      case 't':
        out += '\t';
        i += 1;
        break;
      case 'r':
        out += '\r';
        i += 1;
        break;
      case 'b':
        out += '\b';
        i += 1;
        break;
      case 'f':
        out += '\f';
        i += 1;
        break;
      case 'v':
        out += '\v';
        i += 1;
        break;
      case '0':
        out += '\0';
        i += 1;
        break;
      case '\\':
        out += '\\';
        i += 1;
        break;
      case '"':
        out += '"';
        i += 1;
        break;
      case "'":
        out += "'";
        i += 1;
        break;
      case 'u': {
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 5;
        } else {
          out += char;
        }
        break;
      }
      case 'x': {
        const hex = text.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 3;
        } else {
          out += char;
        }
        break;
      }
      default:
        out += char;
        break;
    }
  }
  return out;
}

// Decodes JSON/C-style escape sequences (e.g., \n, \t) in error messages, preserving real control characters and normalizing line endings.
export function decodeErrorMessageEscapes(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (REAL_CONTROL_PATTERN.test(normalized) || !LITERAL_ESCAPE_PATTERN.test(normalized)) {
    // If the string contains real control characters or no literal escape sequences, return the normalized string.
    return normalized;
  }
  // else decode the literal escape sequences and normalize line endings
  return decodeLiteralEscapes(normalized).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Reads a display string from API-shaped errors: `message`, then nested
 * `error.message`. When neither exists, stringifies the value.
 */
function messageFromErrorShaped(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const direct = readNonEmptyString(value.message);
  if (direct != null) return direct;
  if (isRecord(value.error)) {
    return readNonEmptyString(value.error.message);
  }
  return undefined;
}

function stringifyError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

/**
 * User-facing error text. Prefers HTTP body `{ error: { message } }` when
 * present (e.g. TrueForgeError), then `error.message` / `error.error.message`,
 * then `fallback`, then a string form of the value.
 *
 * Escape sequences (`\n`, `\t`, `\r`, `\uXXXX`, …) are decoded for display when
 * still present as literal text.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (trimmed !== '') return decodeErrorMessageEscapes(error);
    return fallback != null ? decodeErrorMessageEscapes(fallback) : decodeErrorMessageEscapes(error);
  }

  if (isRecord(error) && 'body' in error) {
    const fromBody = messageFromErrorShaped(error.body);
    if (fromBody != null) return decodeErrorMessageEscapes(fromBody);
    if (error.body != null) {
      if (typeof error.body === 'string') {
        const trimmed = error.body.trim();
        if (trimmed !== '') return decodeErrorMessageEscapes(error.body);
      } else {
        return stringifyError(error.body);
      }
    }
  }

  const fromShape = messageFromErrorShaped(error);
  if (fromShape != null) return decodeErrorMessageEscapes(fromShape);

  if (fallback != null) return decodeErrorMessageEscapes(fallback);
  return stringifyError(error);
}
