import { Icon } from '../../icons/Icon.js';
import { CatalogLogo } from '../primitives/CatalogLogo.js';

export type OnboardingOptionLabelProps = {
  name: string;
  description?: string;
  logoSrc?: string;
  /** Icon shown in the logo tile when the catalog has no logo. */
  fallbackIcon: string;
};

/** Logo tile with a name and optional description, shared by provider and connector rows. */
export function OnboardingOptionLabel({ name, description, logoSrc, fallbackIcon }: OnboardingOptionLabelProps) {
  return (
    <>
      <span
        className="border-border bg-secondary-bg/60 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border"
        aria-hidden
      >
        {logoSrc ? (
          <CatalogLogo src={logoSrc} alt="" className="size-4" />
        ) : (
          <Icon name={fallbackIcon} className="text-text-primary size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text-primary block truncate text-[0.9375rem] leading-[1.40625rem] font-medium">
          {name}
        </span>
        {description ? (
          <span className="text-text-secondary block truncate text-xs leading-[1.125rem]">{description}</span>
        ) : null}
      </span>
    </>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    OnboardingOptionLabel: typeof OnboardingOptionLabel;
  }
}
