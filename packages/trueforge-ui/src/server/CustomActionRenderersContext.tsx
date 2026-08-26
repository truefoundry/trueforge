'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';

/** Props Trueforge passes to a host-registered custom action renderer. */
export type CustomActionRendererProps = {
  args: Record<string, unknown>;
  disabled: boolean;
  /** Resume the paused client-side tool with a non-empty string result. */
  onSubmit: (content: string) => void;
};

/** Map of client-side tool name → host UI for composer pause. */
export type CustomActionRenderers = Record<string, ComponentType<CustomActionRendererProps>>;

const CustomActionRenderersContext = createContext<CustomActionRenderers | undefined>(undefined);

export function CustomActionRenderersProvider({
  renderers,
  children,
}: {
  renderers?: CustomActionRenderers;
  children: ReactNode;
}) {
  return <CustomActionRenderersContext.Provider value={renderers}>{children}</CustomActionRenderersContext.Provider>;
}

/** Host-registered custom action renderers, or `undefined` when none were provided. */
export function useOptionalCustomActionRenderers(): CustomActionRenderers | undefined {
  return useContext(CustomActionRenderersContext);
}
