import { CenteredModal, Icon } from '@truefoundry/trueforge-ui';
import { useEffect, useState } from 'react';
import {
  getCachedEmail,
  getCachedIsOidcConnectedSession,
  getCachedRole,
  isOidcConnectedSession,
  logout,
} from './authSession';
import './UserProfile.css';

/** First letter of the email local-part, uppercased — placeholder avatar until real photos exist. */
function initialFor(email: string | undefined): string {
  return email?.trim().charAt(0).toUpperCase() || '?';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Profile row next to Settings (via `ShellActionsActionSlot` override).
 * Shown only when `auth.me()` returns `type: "oidc-connected"`.
 * Uses a module cache so remounts of the action slot do not hide the control during refetches.
 */
export function UserProfile() {
  const [visible, setVisible] = useState(() => getCachedIsOidcConnectedSession() === true);
  const [email, setEmail] = useState(() => getCachedEmail());
  const [role, setRole] = useState(() => getCachedRole());
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const state = { cancelled: false };
    void isOidcConnectedSession()
      .then(ok => {
        if (!state.cancelled) {
          setVisible(ok);
          setEmail(getCachedEmail());
          setRole(getCachedRole());
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
        aria-label={email ? `Account: ${email}` : 'Account'}
        title={email ?? 'Account'}
        className="harness-user-trigger"
        onClick={() => {
          setProfileOpen(true);
        }}
      >
        <span className="harness-user-avatar" aria-hidden="true">
          {email ? initialFor(email) : <Icon name="user" />}
        </span>
        {email ? <span className="harness-user-email">{email}</span> : null}
      </button>

      <CenteredModal open={profileOpen} onOpenChange={setProfileOpen} title="Account" aria-label="Account" contentSized>
        <div className="harness-user-modal">
          <div className="harness-user-modal-header">
            <span className="harness-user-avatar harness-user-avatar-lg" aria-hidden="true">
              {email ? initialFor(email) : <Icon name="user" />}
            </span>
            <div className="harness-user-modal-identity">
              <span className="harness-user-modal-email" title={email}>
                {email}
              </span>
              {role ? <span className="harness-user-modal-role">{capitalize(role)}</span> : null}
            </div>
          </div>
          <div className="harness-user-modal-actions">
            <button
              type="button"
              className="harness-user-logout-row"
              onClick={() => {
                setProfileOpen(false);
                setConfirmOpen(true);
              }}
            >
              <span className="harness-user-logout-icon" aria-hidden="true">
                <Icon name="log-out" />
              </span>
              Log out
            </button>
          </div>
        </div>
      </CenteredModal>

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
