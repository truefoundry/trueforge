import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type {
  ComposerLeftSectionProps,
  ComposerRightSectionProps,
  ComposerSendButtonProps,
} from '../atoms/ComposerSections.js';
import { defaultSlots } from './defaultSlots.js';
import { ThemeProvider, useOptionalThemeMode } from './ThemeProvider.js';
import type { ThemeConfig } from './types.js';

export type { ThemeConfig, ThemeMode } from './types.js';

/**
 * Registry of atom-name -> atom-implementation. Empty by default; each atom module
 * augments this interface via `declare module "../theme/SlotsProvider"` when it is
 * introduced, so adding an atom never requires editing this file or any container.
 */
export interface AtomSlots {
  ComposerLeftSection: ComposerLeftSectionSlot;
  ComposerRightSection: ComposerRightSectionSlot;
  ComposerSendButton: ComposerSendButtonSlot;
}

export type ComposerLeftSectionSlot = (props: ComposerLeftSectionProps) => ReactNode;
export type ComposerRightSectionSlot = (props: ComposerRightSectionProps) => ReactNode;
export type ComposerSendButtonSlot = (props: ComposerSendButtonProps) => ReactNode;

export type SlotOverrides = Partial<AtomSlots>;

const SlotsContext = createContext<AtomSlots>(defaultSlots);
const ThemeModeContext = createContext<'light' | 'dark' | undefined>(undefined);

/** Merges `overrides` over parent/default slots. Containers resolve atoms via `useSlot`. */
export function SlotsProvider({
  overrides,
  theme,
  children,
}: {
  overrides?: SlotOverrides;
  /** Theme config. Pass `mode` for controlled light/dark/system; omit `mode` for uncontrolled. */
  theme?: ThemeConfig;
  children: ReactNode;
}) {
  const parentSlots = useContext(SlotsContext);
  const inheritedTheme = useContext(ThemeModeContext);
  const resolved = useMemo(() => ({ ...parentSlots, ...overrides }) as AtomSlots, [parentSlots, overrides]);

  const slotsTree = (
    <SlotsProviderContents slots={resolved} inheritedTheme={inheritedTheme} theme={theme}>
      {children}
    </SlotsProviderContents>
  );

  // Nest ThemeProvider only when this SlotsProvider owns a theme config, or when
  // there is no parent theme yet (outermost provider).
  const hasParentTheme = inheritedTheme !== undefined;
  if (theme !== undefined || !hasParentTheme) {
    return <ThemeProvider theme={theme}>{slotsTree}</ThemeProvider>;
  }

  return slotsTree;
}

function SlotsProviderContents({
  slots,
  children,
  inheritedTheme,
  theme,
}: {
  slots: AtomSlots;
  children: ReactNode;
  inheritedTheme: 'light' | 'dark' | undefined;
  theme?: ThemeConfig;
}) {
  const modeFromProvider = useOptionalThemeMode();
  const controlledMode = theme?.mode === 'light' || theme?.mode === 'dark' ? theme.mode : undefined;
  const resolvedTheme = controlledMode ?? inheritedTheme ?? modeFromProvider;

  return (
    <ThemeModeContext.Provider value={resolvedTheme}>
      <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>
    </ThemeModeContext.Provider>
  );
}

/** Resolves the atom implementation registered for `name` -- default unless overridden. */
export function useSlot<K extends keyof AtomSlots>(name: K): AtomSlots[K] {
  const slots = useContext(SlotsContext);
  return slots[name];
}

/** Resolves the light or dark theme mode supplied by the SDK consumer. */
export function useThemeMode(): 'light' | 'dark' {
  return useContext(ThemeModeContext) ?? 'light';
}
