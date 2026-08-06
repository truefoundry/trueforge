import {
  createElement,
  isValidElement,
  useContext,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { cn } from '../atoms/lib/cn.js';
import { ThemeContext } from '../theme/ThemeProvider.js';
import type { IconProps as ThemeIconProps } from '../theme/types.js';
import { lookupIcon, resolveIconName, type IconEntry } from './IconRegistry.js';

export type IconProps = ThemeIconProps & {
  name: string | readonly string[];
};

type IconRenderProps = {
  className?: string;
  style?: CSSProperties;
  size?: string | number;
  width?: string | number;
  height?: string | number;
  role?: string;
} & Pick<IconProps, 'aria-hidden' | 'aria-label'>;

function isComponent(entry: IconEntry): boolean {
  if (typeof entry === 'function') return true;
  // Lucide (and other) icons are forwardRef objects, not functions
  return (
    typeof entry === 'object' &&
    entry !== null &&
    !isValidElement(entry) &&
    !Array.isArray(entry) &&
    '$$typeof' in entry
  );
}

function renderEntry(entry: IconEntry, props: IconRenderProps): ReactNode {
  if (isComponent(entry)) {
    const { size, className, style, ...aria } = props;
    return createElement(entry as ComponentType<IconRenderProps>, {
      className: cn('inline-block shrink-0', className),
      style,
      size,
      width: size,
      height: size,
      'aria-hidden': aria['aria-label'] ? undefined : (aria['aria-hidden'] ?? true),
      'aria-label': aria['aria-label'],
      role: aria['aria-label'] ? 'img' : undefined,
    });
  }
  return entry as ReactNode;
}

export function Icon({ name, className, style, size = '1em', ...aria }: IconProps) {
  const themeIcons = useContext(ThemeContext)?.icons;
  const resolved = resolveIconName(name);
  const entry = lookupIcon(resolved, themeIcons);
  if (!entry) return null;
  return <>{renderEntry(entry, { className, style, size, ...aria })}</>;
}

export function useIcon(name: string | readonly string[]): IconEntry | undefined {
  const themeIcons = useContext(ThemeContext)?.icons;
  return lookupIcon(resolveIconName(name), themeIcons);
}
