import { AuthStatusCard } from './AuthStatusCard';

/** Post-logout confirmation (not an error). */
export function LoggedOutScreen() {
  return (
    <AuthStatusCard
      kind="success"
      title="Signed out"
      description="Your session has ended. Return home to sign in again."
    />
  );
}
