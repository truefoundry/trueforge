'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { cn } from '../atoms/lib/cn.js';
import { ensureStyles } from './ensureStyles.js';
import { resolvePresetTokens } from './presets/index.js';
import {
  TOKEN_CSS_VARS,
  type BrandConfig,
  type ContentClassNames,
  type IconMap,
  type SemanticTokens,
  type ThemeConfig,
  type ThemeMode,
  type ThemePreset,
} from './types.js';

export type ThemeContextValue = {
  preset: ThemePreset;
  /** Resolved light/dark (never `"system"`). */
  mode: 'light' | 'dark';
  /** Preference including `"system"` when uncontrolled. */
  preference: ThemeMode;
  isDark: boolean;
  setTheme: (mode: ThemeMode) => void;
  /** Partial: `theme.brand` is optional, so consumers fall back to SDK defaults. */
  brand: Partial<BrandConfig>;
  icons: IconMap;
  classNames: ContentClassNames;
  tokens: Partial<SemanticTokens>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export { ThemeContext };

const STORAGE_KEY = 'aui-theme-preference';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function resolveMode(preference: ThemeMode): 'light' | 'dark' {
  return preference === 'system' ? getSystemTheme() : preference;
}

function readStoredPreference(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* ignore */
  }
  return 'system';
}

function tokensToStyle(tokens: Partial<SemanticTokens> | undefined): CSSProperties {
  if (!tokens) return {};
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens) as [keyof SemanticTokens, string | undefined][]) {
    if (value == null) continue;
    style[TOKEN_CSS_VARS[key]] = value;
  }
  return style as CSSProperties;
}

export function ThemeProvider({ theme, children }: { theme?: ThemeConfig; children: ReactNode }) {
  const isControlled = theme?.mode !== undefined;
  const [preference, setPreference] = useState<ThemeMode>(() => theme?.mode ?? readStoredPreference());
  const [mode, setMode] = useState<'light' | 'dark'>(() => resolveMode(theme?.mode ?? readStoredPreference()));

  useLayoutEffect(() => {
    ensureStyles();
  }, []);

  useLayoutEffect(() => {
    if (theme?.mode !== undefined) {
      setPreference(theme.mode);
      setMode(resolveMode(theme.mode));
      return;
    }
    const stored = readStoredPreference();
    setPreference(stored);
    setMode(resolveMode(stored));
  }, [theme?.mode]);

  useEffect(() => {
    if (isControlled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (preference !== 'system') return;
      setMode(getSystemTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [isControlled, preference]);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      if (isControlled) return;
      setPreference(next);
      setMode(resolveMode(next));
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    },
    [isControlled],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      preset: theme?.preset ?? 'trueforge',
      mode,
      preference,
      isDark: mode === 'dark',
      setTheme,
      brand: theme?.brand ?? {},
      icons: theme?.icons ?? {},
      classNames: theme?.classNames ?? {},
      tokens: theme?.tokens ?? {},
    }),
    [mode, preference, setTheme, theme?.preset, theme?.brand, theme?.icons, theme?.classNames, theme?.tokens],
  );

  const rootStyle = useMemo(
    () =>
      tokensToStyle({
        ...resolvePresetTokens(theme?.preset, mode),
        ...theme?.tokens,
      }),
    [theme?.preset, theme?.tokens, mode],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={cn('aui-theme-root h-full min-h-0', mode === 'dark' && 'dark', theme?.className)}
        data-theme={mode}
        data-preset={theme?.preset ?? 'trueforge'}
        style={rootStyle}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export function useTheme(): Pick<ThemeContextValue, 'preset' | 'mode' | 'preference' | 'isDark' | 'setTheme'> {
  const { preset, mode, preference, isDark, setTheme } = useThemeContext();
  return { preset, mode, preference, isDark, setTheme };
}

/** Configured branding. Fields are optional — `theme.brand` may be omitted entirely. */
export function useBrand(): Partial<BrandConfig> {
  return useThemeContext().brand;
}

export function useContentClassNames(): ContentClassNames {
  return useThemeContext().classNames;
}

export function useThemeIcons(): IconMap {
  return useThemeContext().icons;
}

/** Safe for trees that may sit outside ThemeProvider (falls back to light). */
export function useOptionalThemeMode(): 'light' | 'dark' {
  return useContext(ThemeContext)?.mode ?? 'light';
}

/** Safe for trees that may sit outside ThemeProvider (falls back to trueforge). */
export function useOptionalThemePreset(): ThemePreset {
  return useContext(ThemeContext)?.preset ?? 'trueforge';
}

/** Safe for trees that may sit outside ThemeProvider (falls back to {}). */
export function useOptionalContentClassNames(): ContentClassNames {
  return useContext(ThemeContext)?.classNames ?? {};
}
