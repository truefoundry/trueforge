import { EMBEDDED_STYLES } from './embeddedStyles.js';

export const TRUEFORGE_UI_STYLE_ID = 'trueforge-ui-styles';

/**
 * Injects the published SDK stylesheet once into `document.head`.
 * No-ops when a host already loaded styles (same id) or when CSS was not
 * embedded (dev without a prior CSS build).
 */
export function ensureStyles(css: string = EMBEDDED_STYLES): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TRUEFORGE_UI_STYLE_ID) != null) return;
  if (css.length === 0) return;

  const el = document.createElement('style');
  el.id = TRUEFORGE_UI_STYLE_ID;
  el.setAttribute('data-trueforge-ui', '');
  el.textContent = css;
  document.head.appendChild(el);
}
