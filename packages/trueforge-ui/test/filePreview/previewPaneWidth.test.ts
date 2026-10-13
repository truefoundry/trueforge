import { describe, expect, it } from 'vitest';

import { clampPreviewWidth, defaultPreviewWidth } from '@/filePreview/previewPaneWidth.js';

describe('clampPreviewWidth', () => {
  it('keeps the pane between a minimum and 75% of the row', () => {
    expect(clampPreviewWidth({ requested: 100, rowWidth: 1000 })).toBe(18 * 16);
    expect(clampPreviewWidth({ requested: 900, rowWidth: 1000 })).toBe(750);
    expect(clampPreviewWidth({ requested: 420, rowWidth: 1000 })).toBe(420);
  });

  it('defaults to 42% of the row', () => {
    expect(defaultPreviewWidth(1000)).toBe(420);
  });
});
