import React, { useState } from 'react';

import { cn } from '../lib/cn.js';

const sizeClasses = {
  sm: 'h-6 w-6 text-xs',
  default: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
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
        'flex h-full w-full items-center justify-center rounded-full bg-secondary-bg font-medium text-text-secondary',
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
