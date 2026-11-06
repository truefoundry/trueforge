import { Hono } from 'hono';
import {
  areCatalogSettingsAvailable,
  canEditSchedule,
  canManageOrDeleteEnvironment,
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

describe('areCatalogSettingsAvailable', () => {
  afterEach(() => {
    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.Standalone);
  });

  it('is true outside TrueFoundry, where the platform owns the catalogs', () => {
    expect(areCatalogSettingsAvailable()).toBe(true);

    jest.mocked(getTrueForgeAuthMode).mockReturnValue(TrueForgeAuthMode.TrueFoundry);
    expect(areCatalogSettingsAvailable()).toBe(false);
  });
});

describe('canManageOrDeleteEnvironment', () => {
  it('allows create/mutations for admins only, and never on the reserved default', () => {
    const alice = { roles: ['everyone'] };
    const admin = { roles: ['admin'] };
    expect(canManageOrDeleteEnvironment(admin)).toBe(true);
    expect(canManageOrDeleteEnvironment(alice)).toBe(false);
    expect(canManageOrDeleteEnvironment(admin, 'shared-env')).toBe(true);
    expect(canManageOrDeleteEnvironment(alice, 'shared-env')).toBe(false);
    expect(canManageOrDeleteEnvironment(admin, 'default')).toBe(false);
    expect(canManageOrDeleteEnvironment(alice, 'default')).toBe(false);
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
