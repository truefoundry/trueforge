'use client';

/** Keep portaled chrome under the active theme root, including modal top-layer content. */
export function themePortalRoot(from: HTMLElement | null): HTMLElement {
  const dialog = from?.closest('dialog');
  if (dialog instanceof HTMLElement) return dialog;

  const themeRoot = from?.closest('.aui-theme-root');
  if (themeRoot instanceof HTMLElement) return themeRoot;

  return document.body;
}
