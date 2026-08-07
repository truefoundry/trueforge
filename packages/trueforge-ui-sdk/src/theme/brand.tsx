'use client';

import type { ReactNode } from 'react';

import { useContext } from 'react';

import { cn } from '../atoms/lib/cn.js';
import { Icon } from '../icons/Icon.js';
import { ThemeContext } from './ThemeProvider.js';
import type { BrandConfig, BrandImage } from './types.js';

function DefaultBrandIcon({ className }: { className?: string }) {
  return <Icon name="robot" className={className} />;
}

function DefaultBrandLogo({ className, name }: { className?: string; name: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <BrandIcon className="size-5" />
      <span>{name}</span>
    </span>
  );
}

function renderBrandImage(image: BrandImage | undefined, fallback: ReactNode, className?: string): ReactNode {
  if (image == null) return fallback;
  if (typeof image === 'function') return image({ className });
  if (typeof image === 'object' && image !== null && 'src' in image) {
    return <img src={image.src} alt={image.alt ?? ''} className={className} />;
  }
  return image;
}

function useOptionalBrand(): BrandConfig {
  return useContext(ThemeContext)?.brand ?? {};
}

export function BrandLogo({ className }: { className?: string }) {
  const brand = useOptionalBrand();
  const name = brand.name ?? 'TrueFoundry';
  return <>{renderBrandImage(brand.logo, <DefaultBrandLogo className={className} name={name} />, className)}</>;
}

export function BrandIcon({ className }: { className?: string }) {
  const brand = useOptionalBrand();
  return <>{renderBrandImage(brand.icon, <DefaultBrandIcon className={className} />, className)}</>;
}
