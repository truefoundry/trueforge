import { useSyncExternalStore } from 'react';
import {
  clearApiErrors,
  dismissApiError,
  getApiErrorsSnapshot,
  subscribeApiErrors,
  type ApiErrorRecord,
} from './apiErrors';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false });
}

function formatBody(body: string): string {
  if (body.length === 0) return '(empty response body)';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function ApiErrorRow({ error }: { error: ApiErrorRecord }) {
  return (
    <details className="api-error-row">
      <summary>
        <span className="api-error-status">{error.status ?? 'NET'}</span>
        <span className="api-error-method">{error.method}</span>
        <span className="api-error-url" title={error.url}>
          {error.url}
        </span>
        <span className="api-error-time">{formatTime(error.timestamp)}</span>
        <button
          type="button"
          className="api-error-dismiss"
          aria-label="Dismiss error"
          onClick={event => {
            event.preventDefault();
            dismissApiError(error.id);
          }}
        >
          ×
        </button>
      </summary>
      {error.statusText ? <div className="api-error-statustext">{error.statusText}</div> : null}
      <pre className="api-error-body">{formatBody(error.body)}</pre>
    </details>
  );
}

/** Fixed card at the bottom of the viewport listing every failed API call. */
export function ApiErrorCard() {
  const errors = useSyncExternalStore(subscribeApiErrors, getApiErrorsSnapshot);
  if (errors.length === 0) return null;

  return (
    <div className="api-error-card" role="alert">
      <div className="api-error-card-header">
        <span>
          API errors ({errors.length}
          {errors.length === 1 ? '' : ', latest last'})
        </span>
        <button type="button" className="api-error-clear" onClick={clearApiErrors}>
          Clear all
        </button>
      </div>
      <div className="api-error-list">
        {errors.map(error => (
          <ApiErrorRow key={error.id} error={error} />
        ))}
      </div>
    </div>
  );
}
