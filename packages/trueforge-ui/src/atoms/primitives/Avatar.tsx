import React, { useState } from 'react';

import { cn } from '../lib/cn.js';

const sizeClasses = {
  sm: 'h-5 w-5 text-[0.625rem] leading-none',
  default: 'h-8 w-8 text-sm leading-none',
  lg: 'h-10 w-10 text-base leading-none',
};

export type AvatarProps = React.HTMLAttributes<HTMLDivElement> & {
  size?: 'default' | 'sm' | 'lg';
};

export function Avatar({ className, size = 'default', ...props }: AvatarProps) {
  return (
    <div
      data-slot="avatar"
      data-size={size}
      className={cn('relative flex shrink-0 overflow-hidden rounded-full', sizeClasses[size], className)}
      {...props}
    />
  );
}

export type AvatarImageProps = React.ImgHTMLAttributes<HTMLImageElement>;

export function AvatarImage({ className, src, alt = '', onError, ...props }: AvatarImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) return null;

  return (
    <img
      data-slot="avatar-image"
      src={src}
      alt={alt}
      className={cn('aspect-square h-full w-full object-cover', className)}
      onError={e => {
        setFailed(true);
        onError?.(e);
      }}
      {...props}
    />
  );
}

export type AvatarFallbackProps = React.HTMLAttributes<HTMLDivElement>;

export function AvatarFallback({ className, ...props }: AvatarFallbackProps) {
  return (
    <div
      data-slot="avatar-fallback"
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-primary-button-bg/20 to-primary-button-bg/10 font-medium text-primary-button-bg dark:from-primary-button-bg dark:to-primary-button-hover dark:text-primary-button-text',
        className,
      )}
      {...props}
    />
  );
}

// declare module "../../theme/SlotsProvider.js" {
//   interface AtomSlots {
//     Avatar: typeof Avatar;
//     AvatarImage: typeof AvatarImage;
//     AvatarFallback: typeof AvatarFallback;
//   }
// }
