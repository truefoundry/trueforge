import { Hono } from 'hono';
import {
  hasAdminRole,
  requestContextFromCreatedBySubject,
  resolveRequestContext,
  STANDALONE_REQUEST_CONTEXT,
} from '../../../src/auth/identity';

describe('STANDALONE_REQUEST_CONTEXT', () => {
  it('has the fixed standalone identity shape', () => {
    expect(STANDALONE_REQUEST_CONTEXT).toEqual({
      tenant_id: 'default',
      subject: {
        id: 'trueforge-default',
        type: 'user',
        display_name: 'trueforge-default',
      },
      roles: ['admin'],
      user_credential: null,
    });
  });
});

describe('requestContextFromCreatedBySubject', () => {
  it('builds request identity from a persisted creator snapshot', () => {
    const rc = requestContextFromCreatedBySubject({
      tenant_id: 'acme',
      created_by_subject: {
        subject_id: 'alice',
        subject_type: 'user',
        subject_display_name: 'Alice',
      },
    });
    expect(rc.tenant_id).toBe('acme');
    expect(rc.subject).toEqual({ id: 'alice', type: 'user', display_name: 'Alice' });
    expect(rc.roles).toEqual([]);
    expect(rc.user_credential).toBeNull();
  });
});

describe('hasAdminRole', () => {
  // Unit tests run under STANDALONE=true (.env.test) → mode Standalone.
  it('treats admin as admin and other roles as non-admin in standalone', () => {
    expect(hasAdminRole({ roles: ['admin'] })).toBe(true);
    expect(hasAdminRole({ roles: ['everyone'] })).toBe(false);
    expect(hasAdminRole(STANDALONE_REQUEST_CONTEXT)).toBe(true);
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
