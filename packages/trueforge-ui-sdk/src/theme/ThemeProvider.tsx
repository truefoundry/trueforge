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
  type TokenOverrides,
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
  /** Whether the host opted into the dev token editor. */
  devTokensEnabled: boolean;
  /** Runtime per-mode token edits layered over preset + host tokens. */
  tokenOverrides: TokenOverrides;
  /** Replace the runtime overrides (persisted to localStorage). */
  setTokenOverrides: (next: TokenOverrides) => void;
  /** Clear all runtime overrides, reverting to preset + host tokens. */
  resetTokenOverrides: () => void;
  /** Fully merged tokens for a mode: preset ← host tokens ← runtime overrides. */
  resolveTokens: (mode: 'light' | 'dark') => SemanticTokens;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export { ThemeContext };

const STORAGE_KEY = 'aui-theme-preference';
const TOKEN_OVERRIDES_KEY = 'aui-theme-token-overrides';

function isTokenKey(key: string): key is keyof SemanticTokens {
  return Object.prototype.hasOwnProperty.call(TOKEN_CSS_VARS, key);
}

/** Keep only known token keys with string values — localStorage is untrusted input. */
function sanitizeModeTokens(input: unknown): Partial<SemanticTokens> {
  if (typeof input !== 'object' || input === null) return {};
  const out: Partial<SemanticTokens> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && isTokenKey(key)) {
      out[key] = value;
    }
  }
  return out;
}

function sanitizeOverrides(input: unknown): TokenOverrides {
  if (typeof input !== 'object' || input === null) return {};
  const result: TokenOverrides = {};
  for (const [mode, value] of Object.entries(input)) {
    if (mode !== 'light' && mode !== 'dark') continue;
    const tokens = sanitizeModeTokens(value);
    if (Object.keys(tokens).length > 0) result[mode] = tokens;
  }
  return result;
}

function isEmptyOverrides(overrides: TokenOverrides): boolean {
  return Object.keys(overrides.light ?? {}).length === 0 && Object.keys(overrides.dark ?? {}).length === 0;
}

function readStoredOverrides(): TokenOverrides {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(TOKEN_OVERRIDES_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    return sanitizeOverrides(parsed);
  } catch {
    return {};
  }
}

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
  const [tokenOverrides, setTokenOverridesState] = useState<TokenOverrides>(() => readStoredOverrides());

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

  const setTokenOverrides = useCallback((next: TokenOverrides) => {
    const sanitized = sanitizeOverrides(next);
    setTokenOverridesState(sanitized);
    try {
      if (isEmptyOverrides(sanitized)) {
        localStorage.removeItem(TOKEN_OVERRIDES_KEY);
      } else {
        localStorage.setItem(TOKEN_OVERRIDES_KEY, JSON.stringify(sanitized));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const resetTokenOverrides = useCallback(() => {
    setTokenOverridesState({});
    try {
      localStorage.removeItem(TOKEN_OVERRIDES_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const resolveTokens = useCallback(
    (target: 'light' | 'dark'): SemanticTokens => ({
      ...resolvePresetTokens(theme?.preset, target),
      ...theme?.tokens,
      ...(target === 'light' ? tokenOverrides.light : tokenOverrides.dark),
    }),
    [theme?.preset, theme?.tokens, tokenOverrides],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      preset: theme?.preset ?? 'truefoundry',
      mode,
      preference,
      isDark: mode === 'dark',
      setTheme,
      brand: theme?.brand ?? {},
      icons: theme?.icons ?? {},
      classNames: theme?.classNames ?? {},
      tokens: theme?.tokens ?? {},
      devTokensEnabled: theme?.devTokens ?? false,
      tokenOverrides,
      setTokenOverrides,
      resetTokenOverrides,
      resolveTokens,
    }),
    [
      mode,
      preference,
      setTheme,
      theme?.preset,
      theme?.brand,
      theme?.icons,
      theme?.classNames,
      theme?.tokens,
      theme?.devTokens,
      tokenOverrides,
      setTokenOverrides,
      resetTokenOverrides,
      resolveTokens,
    ],
  );

  const rootStyle = useMemo(() => tokensToStyle(resolveTokens(mode)), [resolveTokens, mode]);

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={cn('aui-theme-root h-full min-h-0', mode === 'dark' && 'dark', theme?.className)}
        data-theme={mode}
        data-preset={theme?.preset ?? 'truefoundry'}
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

/** Runtime token editing surface for the dev token editor. Must be used within a ThemeProvider. */
export function useThemeTokens(): Pick<
  ThemeContextValue,
  'preset' | 'mode' | 'tokenOverrides' | 'setTokenOverrides' | 'resetTokenOverrides' | 'resolveTokens'
> {
  const { preset, mode, tokenOverrides, setTokenOverrides, resetTokenOverrides, resolveTokens } = useThemeContext();
  return { preset, mode, tokenOverrides, setTokenOverrides, resetTokenOverrides, resolveTokens };
}

/** Safe for trees that may sit outside ThemeProvider (falls back to false). */
export function useOptionalDevTokens(): boolean {
  return useContext(ThemeContext)?.devTokensEnabled ?? false;
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

/** Safe for trees that may sit outside ThemeProvider (falls back to truefoundry). */
export function useOptionalThemePreset(): ThemePreset {
  return useContext(ThemeContext)?.preset ?? 'truefoundry';
}

/** Safe for trees that may sit outside ThemeProvider (falls back to {}). */
export function useOptionalContentClassNames(): ContentClassNames {
  return useContext(ThemeContext)?.classNames ?? {};
}
