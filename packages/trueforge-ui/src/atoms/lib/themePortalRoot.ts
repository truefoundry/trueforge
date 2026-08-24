'use client';

/** Keep portaled chrome inside the active theme and native dialog layers. */
export function themePortalRoot(from: HTMLElement | null): HTMLElement {
  const dialog = from?.closest('dialog');
  if (dialog instanceof HTMLElement) return dialog;

  const themeRoot = from?.closest('.aui-theme-root');
  return themeRoot instanceof HTMLElement ? themeRoot : document.body;
}
