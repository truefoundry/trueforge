import { describe, expect, it, vi } from 'vitest';

import { reportSessionAccessError } from '@/utils/sessionAccessError.js';

describe('sessionAccessError', () => {
  it('reports the backend error as-is', () => {
    const onError = vi.fn();
    const forbidden = Object.assign(new Error('Only the session creator can access this session'), {
      statusCode: 403,
    });
    reportSessionAccessError({ error: forbidden, onError });
    expect(onError).toHaveBeenCalledWith(forbidden);
  });

  it('prefers onError over showError', () => {
    const onError = vi.fn();
    const showError = vi.fn();
    const notFound = Object.assign(new Error('Session not found: x'), { statusCode: 404 });
    reportSessionAccessError({
      error: notFound,
      onError,
      showError,
    });
    expect(onError).toHaveBeenCalledWith(notFound);
    expect(showError).not.toHaveBeenCalled();
  });
});
