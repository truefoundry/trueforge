import type { ReactNode } from 'react';

import { Icon } from '../icons/Icon.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { useOptionalThemePreset } from '../theme/ThemeProvider.js';
import { cn } from './lib/cn.js';

export type WelcomeScreenProps = {
  heading?: string;
  icon?: ReactNode;
  className?: string;
};

export function WelcomeScreen({ heading = 'How can I help you today?', icon, className }: WelcomeScreenProps) {
  const preset = useOptionalThemePreset();
  const BrandLogo = useSlot('BrandLogo');
  const resolvedIcon =
    icon !== undefined ? (
      icon
    ) : preset === 'chatgpt' ? null : preset === 'claude' ? (
      <Icon name="welcome-sparkle" className="size-5 fill-current text-primary-button-bg" />
    ) : (
      <BrandLogo variant="icon" className="size-10" />
    );

  return (
    <div
      data-preset={preset}
      className={cn(
        'aui-thread-welcome-root relative isolate mb-6 flex flex-col items-center px-4 text-center text-text-primary',
        preset === 'gemini' && 'py-8',
        className,
      )}
    >
      {preset === 'gemini' && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-button-bg/20 blur-3xl motion-safe:animate-pulse motion-reduce:animate-none [animation-duration:4s]"
        />
      )}
      {resolvedIcon !== null && (
        <div
          className={cn(
            'fill-mode-both mb-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-reduce:animate-none',
            preset === 'claude' ? 'duration-300' : 'duration-200',
          )}
        >
          {resolvedIcon}
        </div>
      )}
      <h1
        className={cn(
          'aui-thread-welcome-message-inner fill-mode-both text-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-reduce:animate-none',
          preset === 'trueforge' ? 'font-semibold' : 'font-normal',
          resolvedIcon !== null && 'delay-75',
          preset === 'gemini' ? 'text-[1.75rem] leading-tight duration-300' : 'duration-200',
        )}
      >
        {heading}
      </h1>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    WelcomeScreen: typeof WelcomeScreen;
  }
}
