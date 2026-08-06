'use client';

/**
 * Host override for sign-out in the shell footer. Default is empty —
 * auth is host-owned (cookie / OIDC), so the SDK never logs out itself.
 */
export function LogoutButton() {
  return null;
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    LogoutButton: typeof LogoutButton;
  }
}
