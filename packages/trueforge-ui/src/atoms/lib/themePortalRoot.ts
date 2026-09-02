/** Keep portaled chrome inside the active dialog/theme boundary. */
export function themePortalRoot(from: HTMLElement | null): HTMLElement {
  const dialog = from?.closest('dialog');
  if (dialog instanceof HTMLElement) return dialog;
  return from?.closest('.aui-theme-root') ?? document.body;
}
