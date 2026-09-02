// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { ensureStyles, TRUEFORGE_UI_FONTS_ID, TRUEFORGE_UI_STYLE_ID } from '@/theme/ensureStyles.js';

describe('ensureStyles', () => {
  afterEach(() => {
    document.getElementById(TRUEFORGE_UI_STYLE_ID)?.remove();
    document.getElementById(TRUEFORGE_UI_FONTS_ID)?.remove();
  });

  it('injects a style tag once', () => {
    ensureStyles('.aui-theme-root{color:red}');
    ensureStyles('.aui-theme-root{color:blue}');

    const nodes = document.querySelectorAll(`#${TRUEFORGE_UI_STYLE_ID}`);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.textContent).toBe('.aui-theme-root{color:red}');
  });

  it('injects Google Sans stylesheet once', () => {
    ensureStyles('.aui-theme-root{color:red}');
    ensureStyles('.aui-theme-root{color:blue}');

    const links = document.querySelectorAll(`#${TRUEFORGE_UI_FONTS_ID}`);
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('rel')).toBe('stylesheet');
    expect(links[0]?.getAttribute('href')).toContain('family=Google+Sans');
  });

  it('still loads fonts when css is empty', () => {
    ensureStyles('');
    expect(document.getElementById(TRUEFORGE_UI_STYLE_ID)).toBeNull();
    expect(document.getElementById(TRUEFORGE_UI_FONTS_ID)).not.toBeNull();
  });
});
