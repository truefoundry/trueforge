'use client';

import { useContext } from 'react';

import { cn } from '../atoms/lib/cn.js';
import { Icon } from '../icons/Icon.js';
import TrueForgeLogoDark from '../icons/trueforge-logo-dark.svg';
import TrueForgeLogoLight from '../icons/trueforge-logo.svg';
import { ThemeContext } from './ThemeProvider.js';
import type { BrandConfig, BrandLogoConfig } from './types.js';

const DEFAULT_BRAND_NAME = 'TrueForge';

/** Expanded / collapsed chrome choices derived from `theme.brand.mode`. */
export type BrandChrome = {
  expandedVariant: 'icon' | 'logo';
  collapsedVariant: 'icon';
  /** Whether to render `name` as visible text beside the mark in expanded chrome. */
  showTitle: boolean;
};

/**
 * Maps `brand.mode` to layout chrome. Layouts should not re-derive field combinations.
 */
export function resolveBrandChrome(brand: Partial<BrandConfig> | undefined): BrandChrome {
  switch (brand?.mode) {
    case 'logo':
      return { expandedVariant: 'logo', collapsedVariant: 'icon', showTitle: false };
    case 'icon-only':
      return { expandedVariant: 'icon', collapsedVariant: 'icon', showTitle: false };
    case 'icon-title':
      return { expandedVariant: 'icon', collapsedVariant: 'icon', showTitle: true };
    default:
      // Omit `brand` (or incomplete Partial) → default TrueForge wordmark.
      return { expandedVariant: 'logo', collapsedVariant: 'icon', showTitle: false };
  }
}

/** Mode-matched source, falling back to the other mode then the mode-agnostic `src`. */
function resolveImageSrc({
  image,
  mode,
}: {
  image: string | BrandLogoConfig;
  mode: 'light' | 'dark';
}): string | undefined {
  if (typeof image === 'string') return image;
  const preferred = mode === 'dark' ? image.dark : image.light;
  return preferred ?? image.light ?? image.dark ?? image.src;
}

/** Configured display name, or the SDK default when no custom brand is set. */
export function useBrandName(): string | undefined {
  const brand = useContext(ThemeContext)?.brand;
  if (brand?.name != null) return brand.name;
  return brand?.mode == null ? DEFAULT_BRAND_NAME : undefined;
}

/**
 * The product mark resolved against the active theme mode. Compact surfaces use
 * `icon`; expanded surfaces use `logo` and fall back to `icon`.
 */
export function BrandLogo({ className, variant = 'icon' }: { className?: string; variant?: 'icon' | 'logo' }) {
  const theme = useContext(ThemeContext);
  const brand = theme?.brand;
  const name = useBrandName();
  const label = name ?? DEFAULT_BRAND_NAME;
  const mode = theme?.mode ?? 'light';
  const preferredImage = variant === 'logo' ? brand?.logo : brand?.icon;
  const preferredSrc = preferredImage == null ? undefined : resolveImageSrc({ image: preferredImage, mode });
  const icon = brand?.icon;
  const src = preferredSrc ?? (variant === 'logo' && icon != null ? resolveImageSrc({ image: icon, mode }) : undefined);

  if (src == null) {
    if (variant === 'logo') {
      const Wordmark = mode === 'dark' ? TrueForgeLogoDark : TrueForgeLogoLight;
      // svgr pins width/height to 1em; clearing both lets the viewBox aspect
      // ratio widen the wordmark to match the caller's height.
      return (
        <Wordmark
          className={cn('w-auto', className)}
          width={undefined}
          height={undefined}
          role="img"
          aria-label={label}
        />
      );
    }
    return (
      <Icon name={mode === 'dark' ? 'trueforge-logomark-dark' : 'trueforge-logomark-light'} className={className} />
    );
  }

  const image = <img src={src} alt={label} className={className} />;
  const href = brand?.href;
  if (href == null) return image;

  return (
    <a href={href} aria-label={label} className="inline-flex items-center">
      {image}
    </a>
  );
}

declare module './SlotsProvider.js' {
  interface AtomSlots {
    BrandLogo: typeof BrandLogo;
  }
}
