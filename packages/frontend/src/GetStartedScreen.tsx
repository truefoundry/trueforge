import { BrandLogo } from '@truefoundry/trueforge-ui';
import { buildLoginHref } from './authFetch';
import './authScreens.css';

/**
 * Pre-auth welcome gate. Rendered when the session probe (`/me`) is unauthenticated
 * (OIDC configured but no session cookie yet). "Let's Get Started" starts OIDC login.
 */
export function GetStartedScreen() {
  return (
    <main className="auth-screen">
      <div className="auth-screen-card">
        <BrandLogo className="auth-screen-logo" />
        <h1 className="auth-screen-title">Welcome to TrueForge</h1>
        <button
          type="button"
          className="auth-screen-button"
          onClick={() => {
            window.location.assign(buildLoginHref());
          }}
        >
          Let&apos;s Get Started
        </button>
      </div>
    </main>
  );
}
