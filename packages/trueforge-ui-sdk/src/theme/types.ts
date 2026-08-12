import type { LucideIcon } from 'lucide-react';
import type { ComponentType, CSSProperties, FC, ReactNode, SVGProps } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemePreset = 'trueforge' | 'claude' | 'chatgpt' | 'gemini';

export type SemanticTokens = {
  // Across product
  sidebarBg: string;
  topbarBg: string;
  primaryBg: string;
  secondaryBg: string;
  border: string;
  fontFamily: string;
  // Building blocks
  inputBoxBg: string;
  inputBorder: string;
  textPrimary: string;
  textSecondary: string;
  cardBg: string;
  dropdownSelectedItemBg: string;
  dropdownSelectedItemText: string;
  // Chat
  userMessageBg: string;
  userMessageText: string;
  assistantMessageBg: string;
  assistantMessageText: string;
  // Buttons
  primaryButtonBg: string;
  primaryButtonHover: string;
  primaryButtonText: string;
  secondaryButtonBg: string;
  secondaryButtonHover: string;
  secondaryButtonText: string;
  ghostButtonBg: string;
  ghostButtonHover: string;
  ghostButtonText: string;
  // Status
  successBg: string;
  successText: string;
  failureBg: string;
  failureText: string;
  warningBg: string;
  warningText: string;
  // Kept internals
  focusRing: string;
  radius: string;
  composerRadius: string;
  overlay: string;
  shadowColor: string;
  scrollbarThumb: string;
};

export type IconProps = {
  className?: string;
  style?: CSSProperties;
  size?: string | number;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
  'data-testid'?: string;
};

export type IconComponent = LucideIcon | ((props: IconProps) => ReactNode) | FC<SVGProps<SVGSVGElement>>;

export type IconEntry = IconComponent | ReactNode;

export type IconMap = Record<string, IconEntry>;

/**
 * Logo sources. `light` / `dark` pick per resolved theme mode and fall back to
 * each other, then to `src`. `href` wraps the logo in a same-tab link. The logo
 * is labelled with `name`; replace the mark itself through the slot table when
 * an image URL is not enough.
 */
export type BrandLogoConfig = {
  src?: string;
  light?: string;
  dark?: string;
  href?: string;
};

/**
 * Setting `brand` requires a `name`: it labels the logo, so a logo without one has
 * no accessible name. `logo` is optional — omit it to pair host text with the stock
 * mark.
 */
export type BrandConfig = {
  /** Display name, and the logo's accessible label. */
  name: string;
  /** Image URL, or per-mode sources. Omit to keep the default mark. */
  logo?: string | BrandLogoConfig;
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

/** Runtime token edits applied on top of the preset + host `theme.tokens`, per resolved mode. */
export type TokenOverrides = {
  light?: Partial<SemanticTokens>;
  dark?: Partial<SemanticTokens>;
};

export type ThemeConfig = {
  preset?: ThemePreset;
  mode?: ThemeMode;
  tokens?: Partial<SemanticTokens>;
  brand?: BrandConfig;
  className?: string;
  icons?: IconMap;
  classNames?: ContentClassNames;
  /** Show the "Tokens (For Dev)" editor in the shell footer. Off by default. */
  devTokens?: boolean;
};

export type BuiltInLayout = 'sidebar' | 'drawer' | 'dock' | 'widget';

export type LayoutProp = BuiltInLayout | ComponentType<{ className?: string }>;

/** camelCase SemanticTokens key → CSS custom property name */
export const TOKEN_CSS_VARS: Record<keyof SemanticTokens, string> = {
  sidebarBg: '--sidebar-bg',
  topbarBg: '--topbar-bg',
  primaryBg: '--primary-bg',
  secondaryBg: '--secondary-bg',
  border: '--border',
  fontFamily: '--font-agent-ui',
  inputBoxBg: '--input-box-bg',
  inputBorder: '--input-border',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  cardBg: '--card-bg',
  dropdownSelectedItemBg: '--dropdown-selected-item-bg',
  dropdownSelectedItemText: '--dropdown-selected-item-text',
  userMessageBg: '--user-message-bg',
  userMessageText: '--user-message-text',
  assistantMessageBg: '--assistant-message-bg',
  assistantMessageText: '--assistant-message-text',
  primaryButtonBg: '--primary-button-bg',
  primaryButtonHover: '--primary-button-hover',
  primaryButtonText: '--primary-button-text',
  secondaryButtonBg: '--secondary-button-bg',
  secondaryButtonHover: '--secondary-button-hover',
  secondaryButtonText: '--secondary-button-text',
  ghostButtonBg: '--ghost-button-bg',
  ghostButtonHover: '--ghost-button-hover',
  ghostButtonText: '--ghost-button-text',
  successBg: '--success-bg',
  successText: '--success-text',
  failureBg: '--failure-bg',
  failureText: '--failure-text',
  warningBg: '--warning-bg',
  warningText: '--warning-text',
  focusRing: '--focus-ring',
  radius: '--radius',
  composerRadius: '--composer-radius',
  overlay: '--overlay',
  shadowColor: '--shadow-color',
  scrollbarThumb: '--scrollbar-thumb',
};

/**
 * Color tokens exposed in the designer token editor.
 * Excludes non-color keys and internal extras (`overlay`, `shadowColor`, `focusRing`, radii).
 */
export type EditableTokenKey =
  | 'sidebarBg'
  | 'topbarBg'
  | 'primaryBg'
  | 'secondaryBg'
  | 'border'
  | 'inputBoxBg'
  | 'inputBorder'
  | 'textPrimary'
  | 'textSecondary'
  | 'cardBg'
  | 'dropdownSelectedItemBg'
  | 'dropdownSelectedItemText'
  | 'userMessageBg'
  | 'userMessageText'
  | 'assistantMessageBg'
  | 'assistantMessageText'
  | 'primaryButtonBg'
  | 'primaryButtonHover'
  | 'primaryButtonText'
  | 'secondaryButtonBg'
  | 'secondaryButtonHover'
  | 'secondaryButtonText'
  | 'ghostButtonBg'
  | 'ghostButtonHover'
  | 'ghostButtonText'
  | 'successBg'
  | 'successText'
  | 'failureBg'
  | 'failureText'
  | 'warningBg'
  | 'warningText'
  | 'scrollbarThumb';

export const EDITABLE_TOKEN_GROUPS: ReadonlyArray<{
  label: string;
  keys: ReadonlyArray<EditableTokenKey>;
}> = [
  {
    label: 'Across product',
    keys: ['sidebarBg', 'topbarBg', 'primaryBg', 'secondaryBg', 'border'],
  },
  {
    label: 'Building blocks',
    keys: [
      'inputBoxBg',
      'inputBorder',
      'textPrimary',
      'textSecondary',
      'cardBg',
      'dropdownSelectedItemBg',
      'dropdownSelectedItemText',
    ],
  },
  {
    label: 'Chat',
    keys: ['userMessageBg', 'userMessageText', 'assistantMessageBg', 'assistantMessageText'],
  },
  {
    label: 'Buttons',
    keys: [
      'primaryButtonBg',
      'primaryButtonHover',
      'primaryButtonText',
      'secondaryButtonBg',
      'secondaryButtonHover',
      'secondaryButtonText',
      'ghostButtonBg',
      'ghostButtonHover',
      'ghostButtonText',
    ],
  },
  {
    label: 'Status',
    keys: ['successBg', 'successText', 'failureBg', 'failureText', 'warningBg', 'warningText', 'scrollbarThumb'],
  },
];

export const EDITABLE_TOKEN_KEYS: ReadonlyArray<EditableTokenKey> = EDITABLE_TOKEN_GROUPS.flatMap(group => group.keys);

export const TOKEN_DESCRIPTIONS: Record<EditableTokenKey, string> = {
  sidebarBg: 'Thread-list / nav rail background.',
  topbarBg: 'Shell header and settings modal headers.',
  primaryBg: 'Page canvas — thread, settings body, dock/widget chrome.',
  secondaryBg: 'Icon wells, soft chips, and secondary nav tracks.',
  border: 'Dividers and outlines on cards, panels, and sections.',
  inputBoxBg: 'Text inputs, search fields, and the composer surface.',
  inputBorder: 'Borders on text fields, selects, and outline buttons.',
  textPrimary: 'Body text, titles, and icons across the UI.',
  textSecondary: 'Captions, placeholders, meta, and secondary labels.',
  cardBg: 'Cards, modals, dropdowns, bottom sheets, and floating menus.',
  dropdownSelectedItemBg: 'Selected / active menu and list rows.',
  dropdownSelectedItemText: 'Text on selected / active rows.',
  userMessageBg: 'User message bubble background.',
  userMessageText: 'Text inside the user message bubble.',
  assistantMessageBg: 'Assistant message bubble background (often transparent).',
  assistantMessageText: 'Text inside the assistant message bubble.',
  primaryButtonBg: 'Primary button fill.',
  primaryButtonHover: 'Primary button hover fill.',
  primaryButtonText: 'Text on primary buttons.',
  secondaryButtonBg: 'Secondary and outline button fill.',
  secondaryButtonHover: 'Secondary / outline button hover fill.',
  secondaryButtonText: 'Text on secondary / outline buttons.',
  ghostButtonBg: 'Ghost button resting fill (usually transparent).',
  ghostButtonHover: 'Ghost button and unselected list-row hover.',
  ghostButtonText: 'Text on ghost buttons.',
  successBg: 'Success pills, icons, and solid success fills.',
  successText: 'Text on success fills.',
  failureBg: 'Errors, deny/fail states, and destructive buttons.',
  failureText: 'Text on failure fills and error banners.',
  warningBg: 'In-progress accents and warning fills.',
  warningText: 'Text on warning fills.',
  scrollbarThumb: 'Scrollbar thumb in scrollable panels.',
};
