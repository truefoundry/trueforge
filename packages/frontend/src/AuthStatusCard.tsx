import type { ReactNode } from 'react';
import './AuthStatusCard.css';

export type AuthStatusKind = 'success' | 'error';

function StatusIcon({ kind }: { kind: AuthStatusKind }): ReactNode {
  if (kind === 'success') {
    return (
      <svg className="auth-status-icon auth-status-icon--success" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="3" />
        <path
          d="M18 33.5 27.5 43 46 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg className="auth-status-icon auth-status-icon--error" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M22 22 42 42M42 22 22 42" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

/** Centered card shell (same layout idea as {@link PostMcpOauthScreen}). */
export function AuthStatusCard(params: { kind: AuthStatusKind; title: string; description: string }) {
  return (
    <main className="auth-status">
      <div className="auth-status-card">
        <StatusIcon kind={params.kind} />
        <h1 className="auth-status-title">{params.title}</h1>
        <p className="auth-status-description">{params.description}</p>
        <a className="auth-status-home" href="/">
          Go to home
        </a>
      </div>
    </main>
  );
}
