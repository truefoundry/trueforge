import { Hono } from 'hono';
import {
  canAccessSettings,
  canCreateOrEdit,
  canEditSchedule,
  hasAdminRole,
  requestContextFromCreatedBySubject,
  resolveRequestContext,
  STANDALONE_REQUEST_CONTEXT,
  TRUEFOUNDRY_TENANT_ADMIN_ROLE,
} from '../../../src/auth/identity';
import { getTrueForgeAuthMode, TrueForgeAuthMode } from '../../../src/config';

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    ...actual,
    getTrueForgeAuthMode: jest.fn(() => actual.TrueForgeAuthMode.Standalone),
  };
});

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
  afterEach(() => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.Standalone);
  });

  // Unit tests run under STANDALONE=true (.env.test) → mode Standalone.
  it('treats admin as admin and other roles as non-admin in standalone', () => {
    expect(hasAdminRole({ roles: ['admin'] })).toBe(true);
    expect(hasAdminRole({ roles: ['everyone'] })).toBe(false);
    expect(hasAdminRole(STANDALONE_REQUEST_CONTEXT)).toBe(true);
  });

  it('treats tenant-admin as admin in TrueFoundry mode', () => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.TrueFoundry);
    expect(hasAdminRole({ roles: [TRUEFOUNDRY_TENANT_ADMIN_ROLE] })).toBe(true);
    expect(hasAdminRole({ roles: ['everyone'] })).toBe(false);
  });
});

describe('canAccessSettings', () => {
  afterEach(() => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.Standalone);
  });

  it('follows hasAdminRole outside TrueFoundry and stays false in TrueFoundry', () => {
    expect(canAccessSettings({ roles: ['admin'] })).toBe(true);
    expect(canAccessSettings({ roles: ['everyone'] })).toBe(false);

    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.TrueFoundry);
    expect(canAccessSettings({ roles: [TRUEFOUNDRY_TENANT_ADMIN_ROLE] })).toBe(false);
    expect(hasAdminRole({ roles: [TRUEFOUNDRY_TENANT_ADMIN_ROLE] })).toBe(true);
  });
});

describe('canCreateOrEdit', () => {
  it('allows create for admins only, and update/delete for admin or creator', () => {
    const alice = { roles: ['everyone'], subject: { id: 'alice', type: 'user', display_name: 'alice' } };
    const bob = { roles: ['everyone'], subject: { id: 'bob', type: 'user', display_name: 'bob' } };
    const admin = { roles: ['admin'], subject: { id: 'root', type: 'user', display_name: 'root' } };
    expect(canCreateOrEdit(admin)).toBe(true);
    expect(canCreateOrEdit(alice)).toBe(false);
    expect(canCreateOrEdit(alice, 'alice')).toBe(true);
    expect(canCreateOrEdit(bob, 'alice')).toBe(false);
    expect(canCreateOrEdit(admin, 'alice')).toBe(true);
  });
});

describe('canEditSchedule', () => {
  it('allows the creator or an admin', () => {
    const alice = { roles: ['everyone'], subject: { id: 'alice', type: 'user', display_name: 'alice' } };
    const bob = { roles: ['everyone'], subject: { id: 'bob', type: 'user', display_name: 'bob' } };
    const admin = { roles: ['admin'], subject: { id: 'root', type: 'user', display_name: 'root' } };
    expect(canEditSchedule(alice, 'alice')).toBe(true);
    expect(canEditSchedule(bob, 'alice')).toBe(false);
    expect(canEditSchedule(admin, 'alice')).toBe(true);
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
