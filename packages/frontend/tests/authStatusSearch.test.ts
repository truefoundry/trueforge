import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAuthErrorReason, shouldShowAuthErrorScreen, stripAuthErrorSearch } from '../src/authStatusSearch';

describe('authStatusSearch', () => {
  it('parseAuthErrorReason reads a non-empty error query', () => {
    assert.equal(parseAuthErrorReason('?error=login_failed'), 'login_failed');
    assert.equal(parseAuthErrorReason('?error=%20'), null);
    assert.equal(parseAuthErrorReason(''), null);
  });

  it('shouldShowAuthErrorScreen only for unauthenticated error landings', () => {
    assert.equal(
      shouldShowAuthErrorScreen({ authError: 'login_failed', session: { status: 'unauthenticated' } }),
      'login_failed',
    );
    assert.equal(shouldShowAuthErrorScreen({ authError: 'login_failed', session: { status: 'checking' } }), null);
    assert.equal(
      shouldShowAuthErrorScreen({
        authError: 'login_failed',
        session: { status: 'authenticated', displayName: 'Ada Lovelace' },
      }),
      null,
    );
    assert.equal(shouldShowAuthErrorScreen({ authError: null, session: { status: 'unauthenticated' } }), null);
  });

  it('stripAuthErrorSearch drops error and keeps other query and hash', () => {
    assert.equal(stripAuthErrorSearch({ pathname: '/', search: '?error=login_failed', hash: '' }), '/');
    assert.equal(
      stripAuthErrorSearch({
        pathname: '/sessions/abc',
        search: '?error=login_failed&tab=1',
        hash: '#composer',
      }),
      '/sessions/abc?tab=1#composer',
    );
  });
});
