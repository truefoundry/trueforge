import { Icon } from '@truefoundry/trueforge-ui';
import { useEffect, useState } from 'react';
import { AUTH_LOGGED_OUT_HREF } from './authFetch';
import { getCachedIsOidcConnectedSession, isOidcConnectedSession, logout } from './authSession';

/**
 * Icon button next to Settings (via `ShellActionsActionSlot` override).
 * Shown only when `auth.me()` returns `type: "oidc-connected"`.
 * Uses a module cache so remounts of the action slot do not hide the control during refetches.
 */
export function LogoutButton() {
  const [visible, setVisible] = useState(() => getCachedIsOidcConnectedSession() === true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const state = { cancelled: false };
    void isOidcConnectedSession()
      .then(ok => {
        if (!state.cancelled) setVisible(ok);
      })
      .catch(() => {
        // Failed refetch must not clear a known-good session (e.g. transient network).
        if (!state.cancelled && getCachedIsOidcConnectedSession() === undefined) {
          setVisible(false);
        }
      });
    return () => {
      state.cancelled = true;
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label="Log out"
      title="Log out"
      disabled={busy}
      className="harness-logout"
      onClick={() => {
        if (busy) return;
        setBusy(true);
        void logout()
          .then(() => {
            window.location.assign(AUTH_LOGGED_OUT_HREF);
          })
          .catch(() => {
            setBusy(false);
          });
      }}
    >
      <Icon name="log-out" />
    </button>
  );
}
