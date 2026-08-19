import { CenteredModal, Icon } from '@truefoundry/trueforge-ui';
import { useEffect, useState } from 'react';
import { getCachedIsOidcConnectedSession, isOidcConnectedSession, logout } from './authSession';
import './LogoutButton.css';

/**
 * Icon button next to Settings (via `ShellActionsActionSlot` override).
 * Shown only when `auth.me()` returns `type: "oidc-connected"`.
 * Uses a module cache so remounts of the action slot do not hide the control during refetches.
 */
export function LogoutButton() {
  const [visible, setVisible] = useState(() => getCachedIsOidcConnectedSession() === true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const state = { cancelled: false };
    void isOidcConnectedSession()
      .then(ok => {
        if (!state.cancelled) {
          setVisible(ok);
        }
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

  const handleConfirm = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    void logout()
      .then(() => {
        // Land on the welcome gate (probe /me → unauthenticated → GetStartedScreen).
        window.location.assign('/');
      })
      .catch(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Log out"
        title="Log out"
        className="harness-logout"
        onClick={() => {
          setConfirmOpen(true);
        }}
      >
        <Icon name="log-out" />
      </button>

      <CenteredModal
        open={confirmOpen}
        onOpenChange={next => {
          if (!busy) {
            setConfirmOpen(next);
          }
        }}
        title="Log out"
        description="Sure to logout?"
        contentSized
      >
        <div className="harness-logout-confirm">
          <button
            type="button"
            className="harness-logout-cancel"
            disabled={busy}
            onClick={() => {
              setConfirmOpen(false);
            }}
          >
            Cancel
          </button>
          <button type="button" className="harness-logout-submit" disabled={busy} onClick={handleConfirm}>
            {busy ? 'Logging out…' : 'Confirm'}
          </button>
        </div>
      </CenteredModal>
    </>
  );
}
