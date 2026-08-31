import { BrandLogo } from '@truefoundry/trueforge-ui';
import { AUTH_LOGIN_HREF } from './authFetch';
import './authScreens.css';

/** OIDC / login failure status. Mirrors the welcome page layout. */
export function AuthErrorScreen({ reason }: { reason: string }) {
  const message = reason === 'login_failed' ? 'We couldn’t complete sign-in. Please try again.' : reason;
  return (
    <main className="auth-screen">
      <div className="auth-screen-card">
        <BrandLogo className="auth-screen-logo" />
        <h1 className="auth-screen-title">Sign-in failed</h1>
        <p className="auth-screen-message">{message}</p>
        <a className="auth-screen-button" href={AUTH_LOGIN_HREF}>
          Try again
        </a>
      </div>
    </main>
  );
}
