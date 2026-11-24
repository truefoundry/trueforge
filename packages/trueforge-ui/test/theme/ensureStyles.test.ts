// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { ensureStyles, TRUEFORGE_UI_STYLE_ID } from '@/theme/ensureStyles.js';
import { DEFAULT_TYPEFACE_ID } from '@/theme/typefaces.js';

const DEFAULT_TYPEFACE_LINK_ID = `trueforge-ui-typeface-${DEFAULT_TYPEFACE_ID}`;

describe('ensureStyles', () => {
  afterEach(() => {
    document.getElementById(TRUEFORGE_UI_STYLE_ID)?.remove();
    document.getElementById(DEFAULT_TYPEFACE_LINK_ID)?.remove();
  });

  it('injects a style tag once', () => {
    ensureStyles('.aui-theme-root{color:red}');
    ensureStyles('.aui-theme-root{color:blue}');

    const nodes = document.querySelectorAll(`#${TRUEFORGE_UI_STYLE_ID}`);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.textContent).toBe('.aui-theme-root{color:red}');
  });

  it('injects IBM Plex Sans stylesheet once', () => {
    ensureStyles('.aui-theme-root{color:red}');
    ensureStyles('.aui-theme-root{color:blue}');

    const links = document.querySelectorAll(`#${DEFAULT_TYPEFACE_LINK_ID}`);
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('rel')).toBe('stylesheet');
    expect(links[0]?.getAttribute('href')).toContain('family=IBM+Plex+Sans');
    expect(links[0]?.getAttribute('href')).toContain('family=IBM+Plex+Mono');
  });

  it('still loads fonts when css is empty', () => {
    ensureStyles('');
    expect(document.getElementById(TRUEFORGE_UI_STYLE_ID)).toBeNull();
    expect(document.getElementById(DEFAULT_TYPEFACE_LINK_ID)).not.toBeNull();
  });
});
