/** True when the SidebarLayout mobile nav dialog is mounted. */
export function isMobileNavDrawerOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-label="Navigation"]') != null;
}
