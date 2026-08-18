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
    assert.equal(shouldShowAuthErrorScreen({ authError: 'login_failed', session: 'unauthenticated' }), true);
    assert.equal(shouldShowAuthErrorScreen({ authError: 'login_failed', session: 'checking' }), false);
    assert.equal(shouldShowAuthErrorScreen({ authError: 'login_failed', session: 'authenticated' }), false);
    assert.equal(shouldShowAuthErrorScreen({ authError: null, session: 'unauthenticated' }), false);
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
