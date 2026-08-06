import { createAuthRouter } from '../../../src/apis/auth';

describe('auth router (no identity provider configured)', () => {
  it('GET /me returns the fixed local identity', async () => {
    const router = createAuthRouter();

    const res = await router.request('/me');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user_ref: 'trueforge-default',
      role: 'admin',
    });
  });

  it('GET /login redirects home — there is nothing to log into', async () => {
    const router = createAuthRouter();

    const res = await router.request('/login', { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('GET /callback redirects home — there is nothing to complete', async () => {
    const router = createAuthRouter();

    const res = await router.request('/callback?state=abc', { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('POST /logout is a no-op 204 — there is no real session to clear', async () => {
    const router = createAuthRouter();

    const res = await router.request('/logout', { method: 'POST' });

    expect(res.status).toBe(204);
  });
});
