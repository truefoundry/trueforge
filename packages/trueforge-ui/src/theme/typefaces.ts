/** User-selectable UI typefaces (Settings → Appearance). */

export const TYPEFACE_IDS = [
  'atkinson-hyperlegible-next',
  'dm-sans',
  'figtree',
  'geist',
  'google-sans',
  'ibm-plex-sans',
  'inclusive-sans',
  'inter',
  'lato',
  'noto-sans',
  'open-sans',
  'source-sans-3',
] as const;

export type TypefaceId = (typeof TYPEFACE_IDS)[number];

export type TypefaceOption = {
  id: TypefaceId;
  /** Display name; render with `fontFamily` so the label uses that face. */
  label: string;
  /** Full `font-family` stack written to `--font-agent-ui`. */
  fontFamily: string;
  /**
   * Optional monospace pair for code (`--font-agent-ui-mono` / `font-mono`).
   * When omitted, system monospace is used.
   */
  monoFontFamily?: string;
  /** Stylesheet to inject once; `null` when the face is already available. */
  stylesheetHref: string | null;
};

const SYSTEM_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function googleFontsCss(families: string): string {
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

const TYPEFACE_CATALOG: readonly TypefaceOption[] = [
  {
    id: 'atkinson-hyperlegible-next',
    label: 'Atkinson Hyperlegible Next',
    fontFamily: `"Atkinson Hyperlegible Next", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Atkinson+Hyperlegible+Next:ital,wght@0,200..800;1,200..800'),
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    fontFamily: `"DM Sans", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000'),
  },
  {
    id: 'figtree',
    label: 'Figtree',
    fontFamily: `"Figtree", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Figtree:ital,wght@0,300..900;1,300..900'),
  },
  {
    id: 'geist',
    label: 'Geist',
    fontFamily: `"Geist", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Geist:wght@100..900'),
  },
  {
    id: 'google-sans',
    label: 'Google Sans',
    fontFamily: `"Google Sans", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700'),
  },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    fontFamily: `"IBM Plex Sans", ${SYSTEM_SANS}`,
    monoFontFamily: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    stylesheetHref: googleFontsCss(
      'family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&family=IBM+Plex+Mono:ital,wght@0,100..700;1,100..700',
    ),
  },
  {
    id: 'inclusive-sans',
    label: 'Inclusive Sans',
    fontFamily: `"Inclusive Sans", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Inclusive+Sans:ital,wght@0,300..700;1,300..700'),
  },
  {
    id: 'inter',
    label: 'Inter',
    fontFamily: `"Inter", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900'),
  },
  {
    id: 'lato',
    label: 'Lato',
    fontFamily: `"Lato", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Lato:ital,wght@0,400;0,700;1,400;1,700'),
  },
  {
    id: 'noto-sans',
    label: 'Noto Sans',
    fontFamily: `"Noto Sans", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Noto+Sans:ital,wght@0,100..900;1,100..900'),
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    fontFamily: `"Open Sans", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Open+Sans:ital,wght@0,300..800;1,300..800'),
  },
  {
    id: 'source-sans-3',
    label: 'Source Sans 3',
    fontFamily: `"Source Sans 3", ${SYSTEM_SANS}`,
    stylesheetHref: googleFontsCss('family=Source+Sans+3:ital,wght@0,200..900;1,200..900'),
  },
];

/** Alphabetized by label for Appearance dropdown. */
export const TYPEFACE_OPTIONS: readonly TypefaceOption[] = [...TYPEFACE_CATALOG].sort((a, b) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
);

const TYPEFACE_BY_ID: ReadonlyMap<TypefaceId, TypefaceOption> = new Map(
  TYPEFACE_CATALOG.map(option => [option.id, option]),
);

export function isTypefaceId(value: string): value is TypefaceId {
  return TYPEFACE_BY_ID.has(value as TypefaceId);
}

export function getTypefaceOption(id: TypefaceId): TypefaceOption {
  const option = TYPEFACE_BY_ID.get(id);
  if (option == null) {
    throw new Error(`Unknown typeface: ${id}`);
  }
  return option;
}

/** Monospace stack for code when the UI typeface declares a pair; else system mono. */
export function getTypefaceMonoFontFamily(option: TypefaceOption): string {
  return option.monoFontFamily ?? SYSTEM_MONO;
}

/** Brand default — matches the `trueforge` preset until the user picks another. */
export const DEFAULT_TYPEFACE_ID: TypefaceId = 'ibm-plex-sans';

export function typefaceMenuLabel(option: TypefaceOption): string {
  return option.id === DEFAULT_TYPEFACE_ID ? `${option.label} (Default)` : option.label;
}
