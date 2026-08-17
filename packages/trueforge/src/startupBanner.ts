/**
 * Standalone boot chrome: wordmark, version, and a boxed local-only warning.
 * Printed raw (not through winston) so the art is not prefixed with timestamps.
 */

const STANDALONE_MODE_DISCLAIMER =
  'Standalone mode is intended for local use on your own machine. It is not hardened for production or shared internet access — please keep it on localhost. We cannot take responsibility for data loss or unauthorized access if this mode is used beyond that.';

/** ANSI Shadow glyphs used to render `TRUEFORGE`. Each letter is six equal-width rows. */
const ANSI_SHADOW: Record<string, readonly string[]> = {
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  F: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '██║     ', '╚═╝     '],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  G: [' ██████╗ ', '██╔════╝ ', '██║  ███╗', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
};

const WORDMARK_TEXT = 'TRUEFORGE';
const WARNING_INNER_WIDTH = 72;
const BRAND_COLOR = '\x1b[38;5;99m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function glyphFor(ch: string): readonly string[] {
  const glyph = ANSI_SHADOW[ch];
  if (glyph === undefined) {
    throw new Error(`No ASCII glyph for ${JSON.stringify(ch)}`);
  }
  return glyph;
}

function rowOf(glyph: readonly string[], row: number): string {
  const cell = glyph[row];
  if (cell === undefined) {
    throw new Error(`Glyph is missing row ${String(row)}`);
  }
  return cell;
}

function renderTrueForgeWordmark(): string {
  const glyphs: (readonly string[])[] = [];
  for (let i = 0; i < WORDMARK_TEXT.length; i += 1) {
    const ch = WORDMARK_TEXT[i];
    if (ch === undefined) {
      throw new Error(`Missing character at index ${String(i)}`);
    }
    glyphs.push(glyphFor(ch));
  }
  const rowCount = glyphs[0]?.length;
  if (rowCount === undefined) {
    throw new Error('Wordmark text must not be empty');
  }
  const rows: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    rows.push(glyphs.map(glyph => rowOf(glyph, row)).join(''));
  }
  return rows.join('\n');
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(word => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      if (word.length > width) {
        lines.push(word);
      } else {
        current = word;
      }
      continue;
    }
    const next = `${current} ${word}`;
    if (next.length <= width) {
      current = next;
    } else {
      lines.push(current);
      current = word.length > width ? '' : word;
      if (word.length > width) {
        lines.push(word);
      }
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function paint(options: { text: string; color: string; enabled: boolean }): string {
  if (!options.enabled) {
    return options.text;
  }
  return `${options.color}${options.text}${RESET}`;
}

function warningBox(message: string): string {
  const label = ' WARNING ';
  const inner = wrapText(message, WARNING_INNER_WIDTH);
  const width = Math.max(WARNING_INNER_WIDTH, ...inner.map(line => line.length), label.length);
  const topPad = width + 1 - label.length;
  const top = `┌─${label}${'─'.repeat(topPad)}┐`;
  const body = inner.map(line => `│ ${line.padEnd(width)} │`);
  const bottom = `└${'─'.repeat(width + 2)}┘`;
  return [top, ...body, bottom].join('\n');
}

function formatStandaloneStartupBanner(options: { version: string; color: boolean }): {
  wordmark: string;
  warning: string;
} {
  const { version, color } = options;
  const wordmark = paint({ text: renderTrueForgeWordmark(), color: `${BOLD}${BRAND_COLOR}`, enabled: color });
  const subtitle = paint({ text: `  TrueForge v${version}  ·  standalone`, color: DIM, enabled: color });
  const warning = paint({ text: warningBox(STANDALONE_MODE_DISCLAIMER), color: `${BOLD}${YELLOW}`, enabled: color });
  return { wordmark: `\n${wordmark}\n${subtitle}\n`, warning };
}

export function printStandaloneStartupBanner(options: { version: string; color: boolean }): void {
  const { wordmark, warning } = formatStandaloneStartupBanner(options);
  console.log(wordmark);
  console.warn(warning);
}
