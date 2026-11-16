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
import { ensureTypefaceStylesheet } from './ensureTypeface.js';
import { resolvePresetTokens } from './presets/index.js';
import { getTypefaceOption, isTypefaceId, type TypefaceId } from './typefaces.js';
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
  /**
   * User-chosen UI typeface from Settings → Appearance.
   * `null` keeps the active preset’s `fontFamily`.
   */
  typefaceId: TypefaceId | null;
  setTypeface: (id: TypefaceId) => void;
  /** Clears the stored typeface preference so the preset default returns. */
  resetTypeface: () => void;
  /** Partial: `theme.brand` is optional, so consumers fall back to SDK defaults. */
  brand: Partial<BrandConfig>;
  icons: IconMap;
  classNames: ContentClassNames;
  tokens: Partial<SemanticTokens>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export { ThemeContext };

const STORAGE_KEY = 'aui-theme-preference';
const TYPEFACE_STORAGE_KEY = 'aui-typeface';

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

function readStoredTypeface(): TypefaceId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(TYPEFACE_STORAGE_KEY);
    if (stored != null && isTypefaceId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return null;
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
  const [typefaceId, setTypefaceId] = useState<TypefaceId | null>(() => readStoredTypeface());

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

  useLayoutEffect(() => {
    if (typefaceId == null) return;
    ensureTypefaceStylesheet(getTypefaceOption(typefaceId));
  }, [typefaceId]);

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

  const setTypeface = useCallback((id: TypefaceId) => {
    setTypefaceId(id);
    ensureTypefaceStylesheet(getTypefaceOption(id));
    try {
      localStorage.setItem(TYPEFACE_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const resetTypeface = useCallback(() => {
    setTypefaceId(null);
    try {
      localStorage.removeItem(TYPEFACE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preset: theme?.preset ?? 'trueforge',
      mode,
      preference,
      isDark: mode === 'dark',
      setTheme,
      typefaceId,
      setTypeface,
      resetTypeface,
      brand: theme?.brand ?? {},
      icons: theme?.icons ?? {},
      classNames: theme?.classNames ?? {},
      tokens: theme?.tokens ?? {},
    }),
    [
      mode,
      preference,
      setTheme,
      typefaceId,
      setTypeface,
      resetTypeface,
      theme?.preset,
      theme?.brand,
      theme?.icons,
      theme?.classNames,
      theme?.tokens,
    ],
  );

  const rootStyle = useMemo(() => {
    const typefaceOverride =
      typefaceId != null ? { fontFamily: getTypefaceOption(typefaceId).fontFamily } : undefined;
    return tokensToStyle({
      ...resolvePresetTokens(theme?.preset, mode),
      ...typefaceOverride,
      // Host token overrides still win (including an explicit fontFamily).
      ...theme?.tokens,
    });
  }, [theme?.preset, theme?.tokens, mode, typefaceId]);

  return (
    <ThemeContext.Provider value={value}>
      <div
        className={cn('aui-theme-root h-full min-h-0', mode === 'dark' && 'dark', theme?.className)}
        data-theme={mode}
        data-preset={theme?.preset ?? 'trueforge'}
        data-typeface={typefaceId ?? undefined}
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

export function useTheme(): Pick<
  ThemeContextValue,
  'preset' | 'mode' | 'preference' | 'isDark' | 'setTheme' | 'typefaceId' | 'setTypeface' | 'resetTypeface'
> {
  const { preset, mode, preference, isDark, setTheme, typefaceId, setTypeface, resetTypeface } =
    useThemeContext();
  return { preset, mode, preference, isDark, setTheme, typefaceId, setTypeface, resetTypeface };
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
