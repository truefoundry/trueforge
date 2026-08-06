import { Icon } from '@truefoundry/trueforge-ui';
import { logout } from '../auth';

/** Clears the OIDC session cookie and reloads into the login gate. */
export function OidcLogoutButton() {
  return (
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
      onClick={() => {
        void logout().then(() => {
          window.location.assign('/');
        });
      }}
    >
      <Icon name="log-out" />
    </button>
  );
}
