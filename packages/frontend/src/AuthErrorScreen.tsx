import { AuthStatusCard } from './AuthStatusCard';

/** OIDC / login failure status. */
export function AuthErrorScreen({ reason }: { reason: string }) {
  return (
    <AuthStatusCard
      kind="error"
      title="Sign-in failed"
      description={reason === 'login_failed' ? 'We could not complete sign-in. Return home to try again.' : reason}
    />
  );
}
