import { Hono } from 'hono';
import { resolveRequestContext, STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';

describe('STANDALONE_REQUEST_CONTEXT', () => {
  it('has the fixed standalone identity shape', () => {
    expect(STANDALONE_REQUEST_CONTEXT).toEqual({
      tenant_id: 'default',
      subject: {
        id: 'trueforge-default',
        type: 'user',
        display_name: 'Admin',
      },
      is_admin: true,
      user_credential: null,
    });
  });
});

describe('resolveRequestContext', () => {
  it('returns request_context when set by auth middleware', async () => {
    const app = new Hono();
    app.get('/', c => {
      c.set('request_context', STANDALONE_REQUEST_CONTEXT);
      return c.json(resolveRequestContext(c));
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STANDALONE_REQUEST_CONTEXT);
  });

  it('throws when request_context is missing', async () => {
    const app = new Hono();
    app.get('/', c => {
      try {
        resolveRequestContext(c);
        return c.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        return c.json({ error: message }, 500);
      }
    });

    const res = await app.request('/');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'RequestContext missing; auth middleware did not run',
    });
  });
});
