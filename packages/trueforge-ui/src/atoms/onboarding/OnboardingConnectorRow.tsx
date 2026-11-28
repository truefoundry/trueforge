import type { ReactNode } from 'react';

import { useSlot } from '../../theme/SlotsProvider.js';

export type OnboardingConnectorRowProps = {
  name: string;
  description?: string;
  logoSrc?: string;
  /** Trailing control: a Connect button or a status badge. */
  action: ReactNode;
};

export function OnboardingConnectorRow({ name, description, logoSrc, action }: OnboardingConnectorRowProps) {
  const OptionLabel = useSlot('OnboardingOptionLabel');
  return (
    <div className="flex min-h-12 w-full shrink-0 items-center gap-3 rounded-md px-3 py-2">
      <OptionLabel
        name={name}
        fallbackIcon="mcp-server"
        {...(description ? { description } : {})}
        {...(logoSrc ? { logoSrc } : {})}
      />
      <div className="shrink-0">{action}</div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    OnboardingConnectorRow: typeof OnboardingConnectorRow;
  }
}
