import { describe, expect, it } from 'vitest';

import { computeMarkdownFoldingRanges } from '../../../src/atoms/draft/markdownFolding.js';

describe('computeMarkdownFoldingRanges', () => {
  it('folds heading sections up to the next same-or-higher heading, trimming trailing blanks', () => {
    const lines = ['# A', 'a', '## B', 'b', '', '# C', 'c'];
    expect(computeMarkdownFoldingRanges(lines)).toEqual(
      expect.arrayContaining([
        { start: 1, end: 4 },
        { start: 3, end: 4 },
        { start: 6, end: 7 },
      ]),
    );
  });

  it('folds fenced blocks and ignores headings inside them', () => {
    const lines = ['```', '# not a heading', '```', 'text'];
    expect(computeMarkdownFoldingRanges(lines)).toEqual([{ start: 1, end: 3 }]);
  });
});
