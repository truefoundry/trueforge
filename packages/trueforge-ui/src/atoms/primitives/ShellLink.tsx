'use client';

import type { AriaAttributes, CSSProperties, MouseEvent, ReactNode } from 'react';

import { useOptionalResolvedRoutes } from '../../routing/ResolvedRoutesContext.js';
import { buildPlaceHref } from '../../routing/paths.js';
import type { RoutePlace } from '../../routing/types.js';

type ShellLinkCommon = {
  onNavigate: () => void;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-current'?: AriaAttributes['aria-current'];
  'aria-expanded'?: AriaAttributes['aria-expanded'];
};

type ShellLinkPlaceProps = ShellLinkCommon & {
  place: RoutePlace;
  /** Optional search override passed to `buildPlaceHref`. */
  search?: string;
  href?: undefined;
};

type ShellLinkHrefProps = ShellLinkCommon & {
  href: string;
  place?: undefined;
  search?: undefined;
};

export type ShellLinkProps = ShellLinkPlaceProps | ShellLinkHrefProps;

function isModifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * In-app navigation that still exposes a real `href` so the browser can
 * right-click / middle-click / Cmd-click open in a new tab. Plain left-clicks
 * call `onNavigate` (existing shell setters) instead of a full reload.
 */
export function ShellLink(props: ShellLinkProps) {
  const routes = useOptionalResolvedRoutes();
  const {
    onNavigate,
    children,
    className,
    disabled,
    title,
    style,
    'aria-label': ariaLabel,
    'aria-current': ariaCurrent,
    'aria-expanded': ariaExpanded,
  } = props;
  const place = props.place;
  const search = props.search;
  const rawHref = props.href;

  const resolvedHref =
    rawHref != null
      ? rawHref
      : place == null || routes == null
        ? null
        : buildPlaceHref({
            place,
            routes,
            ...(search === undefined ? {} : { search }),
          });

  const a11y = {
    ...(title === undefined ? {} : { title }),
    ...(style === undefined ? {} : { style }),
    ...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel }),
    ...(ariaCurrent === undefined ? {} : { 'aria-current': ariaCurrent }),
    ...(ariaExpanded === undefined ? {} : { 'aria-expanded': ariaExpanded }),
  };

  if (resolvedHref == null || disabled) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={onNavigate} {...a11y}>
        {children}
      </button>
    );
  }

  return (
    <a
      href={resolvedHref}
      className={className}
      onClick={event => {
        if (event.defaultPrevented || event.button !== 0 || isModifiedClick(event)) return;
        event.preventDefault();
        onNavigate();
      }}
      {...a11y}
    >
      {children}
    </a>
  );
}
