'use client';

import { useContext } from 'react';

import { Icon } from '../icons/Icon.js';
import { ThemeContext } from './ThemeProvider.js';
import type { BrandLogoConfig } from './types.js';

const DEFAULT_BRAND_NAME = 'TrueForge';

/** Mode-matched source, falling back to the other mode then the mode-agnostic `src`. */
function resolveLogoSrc({
  logo,
  mode,
}: {
  logo: string | BrandLogoConfig;
  mode: 'light' | 'dark';
}): string | undefined {
  if (typeof logo === 'string') return logo;
  const preferred = mode === 'dark' ? logo.dark : logo.light;
  return preferred ?? logo.light ?? logo.dark ?? logo.src;
}

/** Configured brand name, or the SDK default. Safe outside a `ThemeProvider`. */
export function useBrandName(): string {
  return useContext(ThemeContext)?.brand.name ?? DEFAULT_BRAND_NAME;
}

/**
 * The product mark: `theme.brand.logo` resolved against the active theme mode,
 * labelled with the brand name, and linked when the config carries an `href`.
 * Falls back to the default mark when no logo is configured.
 *
 * Callers that also want the name as text render it themselves — the SDK layouts
 * pair this with `useBrandName()` so each one controls its own arrangement.
 */
export function BrandLogo({ className }: { className?: string }) {
  const theme = useContext(ThemeContext);
  const logo = theme?.brand.logo;
  const name = theme?.brand.name ?? DEFAULT_BRAND_NAME;

  const mode = theme?.mode ?? 'light';
  const src = logo == null ? undefined : resolveLogoSrc({ logo, mode });
  if (src == null) {
    return (
      <Icon name={mode === 'dark' ? 'trueforge-logomark-dark' : 'trueforge-logomark-light'} className={className} />
    );
  }

  // `name` is the accessible label: the image itself carries no text alternative.
  const image = <img src={src} alt={name} className={className} />;
  const href = typeof logo === 'string' ? undefined : logo?.href;
  if (href == null) return image;

  return (
    <a href={href} aria-label={name} className="inline-flex items-center">
      {image}
    </a>
  );
}

declare module './SlotsProvider.js' {
  interface AtomSlots {
    BrandLogo: typeof BrandLogo;
  }
}
