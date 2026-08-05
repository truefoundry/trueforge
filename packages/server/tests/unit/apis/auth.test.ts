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

  it('does not mount /login, /callback, or /logout', async () => {
    const router = createAuthRouter();

    const login = await router.request('/login');
    const callback = await router.request('/callback');
    const logout = await router.request('/logout', { method: 'POST' });

    expect(login.status).toBe(404);
    expect(callback.status).toBe(404);
    expect(logout.status).toBe(404);
  });
});
