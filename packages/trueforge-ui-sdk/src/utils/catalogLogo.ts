function splitCatalogLogoUrl(src: string): { dir: string; base: string; ext: string; suffix: string } | undefined {
  const match = /^(.*\/)?([^/?#]+?)(\.[^./?#]+)([?#].*)?$/.exec(src);
  if (match == null) return undefined;
  const dir = match[1] ?? '';
  const base = match[2];
  const ext = match[3];
  const suffix = match[4] ?? '';
  if (base == null || ext == null) return undefined;
  return { dir, base, ext, suffix };
}

/** Insert `-dark` before the file extension. Undefined when already dark-suffixed or unparseable. */
export function toDarkCatalogLogoUrl(src: string): string | undefined {
  const parts = splitCatalogLogoUrl(src);
  if (parts == null || /-dark$/i.test(parts.base)) return undefined;
  return `${parts.dir}${parts.base}-dark${parts.ext}${parts.suffix}`;
}

/** Strip a trailing `-dark` before the file extension. Undefined when not dark-suffixed or unparseable. */
export function toLightCatalogLogoUrl(src: string): string | undefined {
  const parts = splitCatalogLogoUrl(src);
  if (parts == null || !/-dark$/i.test(parts.base)) return undefined;
  return `${parts.dir}${parts.base.replace(/-dark$/i, '')}${parts.ext}${parts.suffix}`;
}

/**
 * Mode-matched logo URL:
 * - dark → prefer icon-dark.ext (derived from icon.ext, or keep if already dark)
 * - light → prefer icon.ext (derived from icon-dark.ext, or keep if already light)
 */
export function resolveCatalogLogoSrc({ src, mode }: { src: string; mode: 'light' | 'dark' }): string {
  if (mode === 'dark') return toDarkCatalogLogoUrl(src) ?? src;
  return toLightCatalogLogoUrl(src) ?? src;
}
