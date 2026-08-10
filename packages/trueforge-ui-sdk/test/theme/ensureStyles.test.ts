// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { ensureStyles, TRUEFORGE_UI_STYLE_ID } from '@/theme/ensureStyles.js';

describe('ensureStyles', () => {
  afterEach(() => {
    document.getElementById(TRUEFORGE_UI_STYLE_ID)?.remove();
  });

  it('injects a style tag once', () => {
    ensureStyles('.aui-theme-root{color:red}');
    ensureStyles('.aui-theme-root{color:blue}');

    const nodes = document.querySelectorAll(`#${TRUEFORGE_UI_STYLE_ID}`);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.textContent).toBe('.aui-theme-root{color:red}');
  });

  it('no-ops when css is empty', () => {
    ensureStyles('');
    expect(document.getElementById(TRUEFORGE_UI_STYLE_ID)).toBeNull();
  });
});
