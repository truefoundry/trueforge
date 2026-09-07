'use client';

import { useEffect, useRef, useState } from 'react';

import { useOptionalContentClassNames, useOptionalThemeMode } from '../theme/ThemeProvider.js';
import { cn } from './lib/cn.js';

export type MonacoEditorCoreProps = {
  value: string;
  language?: string;
  /** Monaco theme name. Defaults to SDK light/dark themes (`aui-monaco-light` / `aui-monaco-dark`). */
  theme?: string;
  options?: Record<string, unknown>;
  onChange?: (value: string) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
  beforeMount?: (monaco: unknown) => void;
  onAutoHeightChange?: (height: number) => void; // Reports Monaco's measured, clamped content height while `autoHeight` is active.
  className?: string;
  /**
   * Fixed height. Ignored when `autoHeight` is true (except as an initial
   * fallback before the editor mounts). Use `"100%"` for fill-parent layouts
   * (e.g. fullscreen dialogs) with `autoHeight={false}`.
   */
  height?: string | number;
  /** Grow/shrink to content height, capped by `maxHeight`. Default false. */
  autoHeight?: boolean;
  /** Cap for `autoHeight` (px number or CSS length). Default `10.5rem`. */
  maxHeight?: string | number;
  /** Floor for `autoHeight` (px number or CSS length). Default one line. */
  minHeight?: string | number;
};

type MonacoEditor = {
  getValue(): string;
  setValue(value: string): void;
  getContentHeight(): number;
  onDidChangeModelContent(listener: () => void): { dispose(): void };
  onDidContentSizeChange(listener: () => void): { dispose(): void };
  updateOptions(options: Record<string, unknown>): void;
  dispose(): void;
  layout(): void;
};

type MonacoModule = {
  editor: {
    create(container: HTMLElement, options: Record<string, unknown>): MonacoEditor;
    defineTheme(
      name: string,
      theme: {
        base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
        inherit: boolean;
        rules: unknown[];
        colors: Record<string, string>;
      },
    ): void;
    setTheme(name: string): void;
  };
};

const AUI_MONACO_LIGHT = 'aui-monaco-light';
const AUI_MONACO_DARK = 'aui-monaco-dark';
const TRANSPARENT = '#00000000';
const DEFAULT_LINE_HEIGHT = 18;
const DEFAULT_VERTICAL_PADDING = 8;
const DEFAULT_MAX_HEIGHT = '10.5rem';

function defineAuiThemes(monaco: MonacoModule) {
  const sharedColors = {
    'editor.background': TRANSPARENT,
    'editor.lineHighlightBackground': TRANSPARENT,
    'editor.lineHighlightBorder': TRANSPARENT,
    'editorGutter.background': TRANSPARENT,
    'minimap.background': TRANSPARENT,
    focusBorder: TRANSPARENT,
    'scrollbar.shadow': TRANSPARENT,
    'editorOverviewRuler.border': TRANSPARENT,
    'editorOverviewRuler.background': TRANSPARENT,
  };

  monaco.editor.defineTheme(AUI_MONACO_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: sharedColors,
  });

  monaco.editor.defineTheme(AUI_MONACO_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: sharedColors,
  });
}

function resolveThemeName(
  explicit: string | undefined,
  classNameTheme: string | undefined,
  mode: 'light' | 'dark',
): string {
  if (explicit) return explicit;
  if (classNameTheme) return classNameTheme;
  return mode === 'dark' ? AUI_MONACO_DARK : AUI_MONACO_LIGHT;
}

function toPx(value: string | number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (trimmed.endsWith('rem')) {
    const rem = parseFloat(trimmed);
    const root =
      typeof document !== 'undefined' ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 : 16;
    return Number.isFinite(rem) ? rem * root : fallback;
  }
  if (trimmed.endsWith('px')) {
    const px = parseFloat(trimmed);
    return Number.isFinite(px) ? px : fallback;
  }
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

function estimateHeightFromValue(value: string, minPx: number, maxPx: number): number {
  const lines = Math.max(1, value.split('\n').length);
  const estimated = lines * DEFAULT_LINE_HEIGHT + DEFAULT_VERTICAL_PADDING;
  return Math.min(maxPx, Math.max(minPx, estimated));
}

const EMBEDDED_DEFAULTS: Record<string, unknown> = {
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  // Don't paint a blank last line when the buffer ends with `\n`.
  renderFinalNewline: 'off',
  wordWrap: 'on',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  lineHeight: DEFAULT_LINE_HEIGHT,
  padding: { top: 4, bottom: 4 },
  renderLineHighlight: 'none',
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  glyphMargin: false,
  folding: true,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
    useShadows: false,
  },
  stickyScroll: { enabled: false },
};

export function MonacoEditorCore({
  value,
  language = 'plaintext',
  theme,
  options,
  onChange,
  onMount,
  beforeMount,
  onAutoHeightChange,
  className,
  height = 400,
  autoHeight = false,
  maxHeight = DEFAULT_MAX_HEIGHT,
  minHeight,
}: MonacoEditorCoreProps) {
  const mode = useOptionalThemeMode();
  const classNames = useOptionalContentClassNames();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  const onChangeRef = useRef(onChange);
  const onMountRef = useRef(onMount);
  const beforeMountRef = useRef(beforeMount);
  const onAutoHeightChangeRef = useRef(onAutoHeightChange);
  onChangeRef.current = onChange;
  onMountRef.current = onMount;
  beforeMountRef.current = beforeMount;
  onAutoHeightChangeRef.current = onAutoHeightChange;

  const minPx = toPx(minHeight, DEFAULT_LINE_HEIGHT + DEFAULT_VERTICAL_PADDING);
  const maxPx = toPx(maxHeight, toPx(DEFAULT_MAX_HEIGHT, 168));
  const clampRef = useRef({ minPx, maxPx, autoHeight });
  clampRef.current = { minPx, maxPx, autoHeight };

  const [autoPx, setAutoPx] = useState(() => (autoHeight ? estimateHeightFromValue(value, minPx, maxPx) : 0));

  const resolvedTheme = resolveThemeName(theme, classNames.monaco?.monacoTheme, mode);

  const syncAutoHeight = () => {
    const editor = editorRef.current;
    const wrapper = wrapperRef.current;
    const { minPx: min, maxPx: max, autoHeight: enabled } = clampRef.current;
    if (!editor || !wrapper || !enabled) return;
    const next = Math.min(max, Math.max(min, editor.getContentHeight()));
    setAutoPx(next);
    wrapper.style.height = `${next}px`;
    editor.layout();
    onAutoHeightChangeRef.current?.(next);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    let editor: MonacoEditor | null = null;
    let changeDisposable: { dispose(): void } | null = null;
    let sizeDisposable: { dispose(): void } | null = null;
    let destroyed = false;

    void import('monaco-editor').then(mod => {
      if (destroyed || !containerRef.current) return;

      const monaco = mod as unknown as MonacoModule;
      monacoRef.current = monaco;
      defineAuiThemes(monaco);
      beforeMountRef.current?.(monaco);

      editor = monaco.editor.create(containerRef.current, {
        value,
        language,
        theme: resolvedTheme,
        ...EMBEDDED_DEFAULTS,
        ...options,
      });

      editorRef.current = editor;

      changeDisposable = editor.onDidChangeModelContent(() => {
        onChangeRef.current?.(editor!.getValue());
      });

      if (autoHeight) {
        sizeDisposable = editor.onDidContentSizeChange(() => {
          syncAutoHeight();
        });
        // Layout after first paint so getContentHeight is accurate.
        requestAnimationFrame(() => syncAutoHeight());
      }

      onMountRef.current?.(editor, monaco);
    });

    return () => {
      destroyed = true;
      changeDisposable?.dispose();
      sizeDisposable?.dispose();
      editor?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only: editor manages its own state

  // Sync external value changes without recreating the editor.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
      if (autoHeight) {
        requestAnimationFrame(() => syncAutoHeight());
      }
    }
  }, [value, autoHeight, minPx, maxPx]);

  // Re-clamp when max/min change.
  useEffect(() => {
    if (autoHeight) {
      requestAnimationFrame(() => syncAutoHeight());
    }
  }, [autoHeight, minPx, maxPx]);

  // Follow light/dark (and host theme overrides) after mount.
  useEffect(() => {
    monacoRef.current?.editor.setTheme(resolvedTheme);
  }, [resolvedTheme]);

  const styleHeight = autoHeight ? autoPx : typeof height === 'number' ? height : height;

  return (
    <div
      ref={wrapperRef}
      className={cn('aui-monaco overflow-hidden', classNames.monaco?.root, className)}
      style={{ height: styleHeight }}
    >
      <div ref={containerRef} className={cn('h-full w-full overflow-hidden', classNames.monaco?.editor)} />
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    MonacoEditorCore: typeof MonacoEditorCore;
  }
}
