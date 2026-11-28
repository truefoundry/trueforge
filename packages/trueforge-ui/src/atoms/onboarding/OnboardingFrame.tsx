import type { ReactNode } from 'react';

import bannerHero from '../../assets/onboarding/banner-hero.png';
import TrueForgeLogoDark from '../../icons/trueforge-logo-dark.svg';

export type OnboardingFrameProps = {
  title: string;
  stepper: ReactNode;
  children: ReactNode;
};

const backdropStyle = {
  backgroundImage:
    'radial-gradient(60% 40% at 0% 0%, rgba(59,130,246,0.08), transparent), radial-gradient(60% 40% at 100% 0%, rgba(99,102,241,0.08), transparent)',
};

// The hero art is cropped on a hard edge; fading it in keeps it from reading as a pasted rectangle on the black banner.
const heroFadeStyle = {
  maskImage: 'linear-gradient(to right, transparent, black 40%)',
  WebkitMaskImage: 'linear-gradient(to right, transparent, black 40%)',
};

/** Full-screen first-run page: heading, step indicator and a card with the branded banner. */
export function OnboardingFrame({ title, stepper, children }: OnboardingFrameProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="bg-primary-bg fixed inset-0 z-[100] overflow-y-auto"
      style={backdropStyle}
    >
      <div className="mx-auto flex w-full max-w-[45.625rem] flex-col gap-5 px-4 pt-[4.25rem] pb-5">
        <h1 className="text-text-primary text-2xl leading-[1.875rem] font-semibold">{title}</h1>
        <div className="flex flex-col gap-4">
          {stepper}
          <div className="border-border bg-card-bg flex h-[34rem] flex-col gap-[1.6875rem] overflow-hidden rounded-2xl border px-7 pt-7 pb-5">
            <div
              aria-hidden
              className="relative -mx-7 -mt-7 -mb-[0.0625rem] h-[6.25rem] shrink-0 overflow-hidden rounded-t-[0.9375rem] bg-black"
            >
              <img
                src={bannerHero}
                alt=""
                className="pointer-events-none absolute top-[-2.46875rem] right-0 h-[12.5625rem] w-[19.0625rem] max-w-none object-cover"
                style={heroFadeStyle}
              />
              <TrueForgeLogoDark className="absolute top-1/2 left-7 h-5 w-[7.675rem] -translate-y-1/2" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    OnboardingFrame: typeof OnboardingFrame;
  }
}
