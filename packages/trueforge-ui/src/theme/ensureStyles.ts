import { EMBEDDED_STYLES } from './embeddedStyles.js';

export const TRUEFORGE_UI_STYLE_ID = 'trueforge-ui-styles';
export const TRUEFORGE_UI_FONTS_ID = 'trueforge-ui-fonts';

/** Default UI face — https://fonts.google.com/specimen/Google+Sans */
const GOOGLE_SANS_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&display=swap';

function ensureGoogleSans(): void {
  if (document.getElementById(TRUEFORGE_UI_FONTS_ID) != null) return;
  const link = document.createElement('link');
  link.id = TRUEFORGE_UI_FONTS_ID;
  link.rel = 'stylesheet';
  link.href = GOOGLE_SANS_STYLESHEET;
  document.head.appendChild(link);
}

/**
 * Injects the published SDK stylesheet once into `document.head`, and loads
 * Google Sans for the default `trueforge` preset.
 * No-ops when a host already loaded styles (same id) or when CSS was not
 * embedded (dev without a prior CSS build).
 */
export function ensureStyles(css: string = EMBEDDED_STYLES): void {
  if (typeof document === 'undefined') return;
  ensureGoogleSans();
  if (document.getElementById(TRUEFORGE_UI_STYLE_ID) != null) return;
  if (css.length === 0) return;

  const el = document.createElement('style');
  el.id = TRUEFORGE_UI_STYLE_ID;
  el.setAttribute('data-trueforge-ui', '');
  el.textContent = css;
  document.head.appendChild(el);
}
