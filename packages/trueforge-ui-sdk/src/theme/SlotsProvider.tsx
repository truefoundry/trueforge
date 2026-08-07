import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { defaultSlots } from './defaultSlots.js';
import type { PublicAtomSlots, SlotOverrides } from './publicSlots.js';
import { ThemeProvider, useOptionalThemeMode } from './ThemeProvider.js';
import type { ThemeConfig } from './types.js';

export type { ThemeConfig, ThemeMode } from './types.js';

/**
 * Internal completeness contract augmented by each slotted atom.
 * `defaultSlots` satisfies this interface and owns the public slot keys.
 */
export interface AtomSlots {}

export type { SlotOverrides } from './publicSlots.js';

const SlotsContext = createContext<PublicAtomSlots>(defaultSlots);
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
  const resolved = useMemo(() => ({ ...parentSlots, ...overrides }), [parentSlots, overrides]);

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
  slots: PublicAtomSlots;
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
export function useSlot<K extends keyof PublicAtomSlots>(name: K): PublicAtomSlots[K] {
  const slots = useContext(SlotsContext);
  return slots[name];
}

/** Whether the currently resolved slot is the SDK's stock implementation. */
export function useSlotIsDefault<K extends keyof PublicAtomSlots>(name: K): boolean {
  const slots = useContext(SlotsContext);
  return slots[name] === defaultSlots[name];
}

/** Resolves the light or dark theme mode supplied by the SDK consumer. */
export function useThemeMode(): 'light' | 'dark' {
  return useContext(ThemeModeContext) ?? 'light';
}
