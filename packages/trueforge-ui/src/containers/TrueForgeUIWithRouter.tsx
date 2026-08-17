'use client';

import { useMemo, type ComponentProps } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { resolveRoutesConfig } from '../routing/paths.js';
import { TrueForgeUIShell } from './TrueForgeUIShell.js';

/**
 * `withRouter` entry point. Owns a `BrowserRouter` and hands the resolved route
 * templates to the shell, which mounts `ShellRouteSync`. This module statically
 * imports react-router and is only loaded lazily from `TrueForgeUI`.
 */
export function TrueForgeUIWithRouter({
  routes,
  ...rest
}: Omit<ComponentProps<typeof TrueForgeUIShell>, 'resolvedRoutes'>) {
  const resolved = useMemo(() => resolveRoutesConfig(routes), [routes]);
  return (
    <BrowserRouter basename={resolved.basename || undefined}>
      <TrueForgeUIShell {...rest} resolvedRoutes={resolved} />
    </BrowserRouter>
  );
}
