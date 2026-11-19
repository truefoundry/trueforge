import type { TypefaceOption } from './typefaces.js';

const TRUEFORGE_UI_FONTS_PRECONNECT_GOOGLE_ID = 'trueforge-ui-fonts-preconnect-google';
const TRUEFORGE_UI_FONTS_PRECONNECT_GSTATIC_ID = 'trueforge-ui-fonts-preconnect-gstatic';

function ensurePreconnect({ id, href, crossOrigin }: { id: string; href: string; crossOrigin?: string }): void {
  if (document.getElementById(id) != null) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'preconnect';
  link.href = href;
  if (crossOrigin != null) link.crossOrigin = crossOrigin;
  document.head.appendChild(link);
}

function ensureGoogleFontsPreconnect(): void {
  ensurePreconnect({ id: TRUEFORGE_UI_FONTS_PRECONNECT_GOOGLE_ID, href: 'https://fonts.googleapis.com' });
  ensurePreconnect({
    id: TRUEFORGE_UI_FONTS_PRECONNECT_GSTATIC_ID,
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  });
}

function stylesheetElementId(typefaceId: string): string {
  return `trueforge-ui-typeface-${typefaceId}`;
}

/** Inject a typeface stylesheet once (Google Fonts). */
export function ensureTypefaceStylesheet(option: TypefaceOption): void {
  if (typeof document === 'undefined') return;
  if (option.stylesheetHref == null) return;
  if (document.getElementById(stylesheetElementId(option.id)) != null) return;

  if (option.stylesheetHref.includes('fonts.googleapis.com')) {
    ensureGoogleFontsPreconnect();
  }

  const link = document.createElement('link');
  link.id = stylesheetElementId(option.id);
  link.rel = 'stylesheet';
  link.href = option.stylesheetHref;
  document.head.appendChild(link);
}

/** Prefetch every catalog face so Appearance labels render in their own typefaces. */
export function ensureAllTypefaceStylesheets(options: readonly TypefaceOption[]): void {
  for (const option of options) {
    ensureTypefaceStylesheet(option);
  }
}
