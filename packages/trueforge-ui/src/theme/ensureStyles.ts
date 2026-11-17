import { EMBEDDED_STYLES } from './embeddedStyles.js';
import { getTypefaceOption } from './typefaces.js';

export const TRUEFORGE_UI_STYLE_ID = 'trueforge-ui-styles';
export const TRUEFORGE_UI_FONTS_ID = 'trueforge-ui-fonts';
export const TRUEFORGE_UI_FONTS_PRECONNECT_GOOGLE_ID = 'trueforge-ui-fonts-preconnect-google';
export const TRUEFORGE_UI_FONTS_PRECONNECT_GSTATIC_ID = 'trueforge-ui-fonts-preconnect-gstatic';

/** Default UI face (Geist) — stylesheet from the typeface catalog. */
const DEFAULT_TYPEFACE_STYLESHEET = getTypefaceOption('geist').stylesheetHref;

function ensureFontPreconnect({ id, href, crossOrigin }: { id: string; href: string; crossOrigin?: string }): void {
  if (document.getElementById(id) != null) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'preconnect';
  link.href = href;
  if (crossOrigin != null) link.crossOrigin = crossOrigin;
  document.head.appendChild(link);
}

function ensureDefaultTypeface(): void {
  if (DEFAULT_TYPEFACE_STYLESHEET == null) return;
  if (DEFAULT_TYPEFACE_STYLESHEET.includes('fonts.googleapis.com')) {
    ensureFontPreconnect({
      id: TRUEFORGE_UI_FONTS_PRECONNECT_GOOGLE_ID,
      href: 'https://fonts.googleapis.com',
    });
    ensureFontPreconnect({
      id: TRUEFORGE_UI_FONTS_PRECONNECT_GSTATIC_ID,
      href: 'https://fonts.gstatic.com',
      crossOrigin: 'anonymous',
    });
  }
  if (document.getElementById(TRUEFORGE_UI_FONTS_ID) != null) return;
  const link = document.createElement('link');
  link.id = TRUEFORGE_UI_FONTS_ID;
  link.rel = 'stylesheet';
  link.href = DEFAULT_TYPEFACE_STYLESHEET;
  document.head.appendChild(link);
}

/**
 * Injects the published SDK stylesheet once into `document.head`, and loads
 * Geist for the default `trueforge` preset.
 * No-ops when a host already loaded styles (same id) or when CSS was not
 * embedded (dev without a prior CSS build).
 */
export function ensureStyles(css: string = EMBEDDED_STYLES): void {
  if (typeof document === 'undefined') return;
  ensureDefaultTypeface();
  if (document.getElementById(TRUEFORGE_UI_STYLE_ID) != null) return;
  if (css.length === 0) return;

  const el = document.createElement('style');
  el.id = TRUEFORGE_UI_STYLE_ID;
  el.setAttribute('data-trueforge-ui', '');
  el.textContent = css;
  document.head.appendChild(el);
}
