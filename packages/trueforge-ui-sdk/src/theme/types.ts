import type { LucideIcon } from 'lucide-react';
import type { ComponentType, CSSProperties, FC, ReactNode, SVGProps } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemePreset = 'truefoundry' | 'claude' | 'chatgpt' | 'gemini';

export type SemanticTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  border: string;
  input: string;
  ring: string;
  radius: string;
  fontFamily: string;
  composerRadius?: string;
  userBubble?: string;
  userBubbleForeground?: string;
  assistantBubble?: string;
  assistantBubbleForeground?: string;
  /** Scrollbar thumb (“plug”) color. Defaults to `--muted-foreground`. */
  scrollbarThumb?: string;
};

export type IconProps = {
  className?: string;
  style?: CSSProperties;
  size?: string | number;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
};

export type IconMap = Record<
  string,
  LucideIcon | ReactNode | ((props: IconProps) => ReactNode) | FC<SVGProps<SVGSVGElement>>
>;

export type BrandImage = { src: string; alt?: string } | ReactNode | ((props: { className?: string }) => ReactNode);

export type BrandConfig = {
  logo?: BrandImage;
  icon?: BrandImage;
  name?: string;
};

export type ContentClassNames = {
  markdown?: string;
  inlineCode?: string;
  syntaxHighlighter?: {
    root?: string;
    pre?: string;
    code?: string;
    lineNumber?: string;
  };
  openui?: {
    root?: string;
    scope?: string;
  };
  monaco?: {
    root?: string;
    editor?: string;
    monacoTheme?: string;
  };
};

export type ThemeConfig = {
  preset?: ThemePreset;
  mode?: ThemeMode;
  tokens?: Partial<SemanticTokens>;
  brand?: BrandConfig;
  className?: string;
  icons?: IconMap;
  classNames?: ContentClassNames;
};

export type BuiltInLayout = 'sidebar' | 'drawer' | 'dock' | 'widget';

export type LayoutProp = BuiltInLayout | ComponentType<{ className?: string }>;

/** camelCase SemanticTokens key → CSS custom property name */
export const TOKEN_CSS_VARS: Record<keyof SemanticTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  success: '--success',
  successForeground: '--success-foreground',
  warning: '--warning',
  warningForeground: '--warning-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  radius: '--radius',
  fontFamily: '--font-agent-ui',
  composerRadius: '--composer-radius',
  userBubble: '--user-bubble',
  userBubbleForeground: '--user-bubble-foreground',
  assistantBubble: '--assistant-bubble',
  assistantBubbleForeground: '--assistant-bubble-foreground',
  scrollbarThumb: '--scrollbar-thumb',
};
