export type MarkdownFoldingRange = { start: number; end: number };

const HEADING = /^(#{1,6})\s/;
const FENCE = /^\s*(```|~~~)/;

/** Monaco's markdown mode only folds `<!-- #region -->`; fold heading sections and fenced blocks too. */
export function computeMarkdownFoldingRanges(lines: readonly string[]): MarkdownFoldingRange[] {
  const ranges: MarkdownFoldingRange[] = [];
  const openHeadings: { level: number; start: number }[] = [];
  let fenceStart: number | null = null;
  let fenceMarker = '';

  const closeHeadingsAt = ({ level, endLine }: { level: number; endLine: number }) => {
    for (
      let heading = openHeadings.at(-1);
      heading !== undefined && heading.level >= level;
      heading = openHeadings.at(-1)
    ) {
      openHeadings.pop();
      let end = endLine;
      while (end > heading.start && lines[end - 1]?.trim() === '') end -= 1;
      if (end > heading.start) ranges.push({ start: heading.start, end });
    }
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fence = FENCE.exec(line);
    if (fenceStart !== null) {
      if (fence !== null && fence[1] === fenceMarker) {
        if (lineNumber > fenceStart) ranges.push({ start: fenceStart, end: lineNumber });
        fenceStart = null;
      }
      return;
    }
    if (fence !== null) {
      fenceStart = lineNumber;
      fenceMarker = fence[1] ?? '';
      return;
    }
    const heading = HEADING.exec(line);
    if (heading === null) return;
    const level = heading[1]?.length ?? 1;
    closeHeadingsAt({ level, endLine: lineNumber - 1 });
    openHeadings.push({ level, start: lineNumber });
  });

  closeHeadingsAt({ level: 0, endLine: lines.length });
  return ranges;
}
