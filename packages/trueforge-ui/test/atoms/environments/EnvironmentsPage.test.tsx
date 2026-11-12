// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import type { TrackAnalytics } from '@/analytics/types.js';
import { EnvironmentsButton } from '@/atoms/EnvironmentsButton.js';
import { EnvironmentsPage, PENDING_ENVIRONMENTS_POLL_INTERVAL_MS } from '@/atoms/environments/EnvironmentsPage.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { CurrentUserProvider, type CurrentUser } from '@/contexts/CurrentUserContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type {
  ListPermissionsRequest,
  ListPermissionsResponse,
  PermissionsServer,
  SandboxEnvironment,
  SandboxEnvironmentServer,
} from '@/server/types.js';
import {
  createMockAgentUIServer,
  createMockCatalog,
  createMockSandboxEnvironmentServer,
} from '../../server/mockServer.js';

const sampleEnvironments: SandboxEnvironment[] = [
  {
    id: 'e1',
    name: 'python-data',
    description: 'Python with httpx',
    status: 'ready',
    enabled: true,
    isDefault: false,
    statusReason: null,
    manifest: {
      name: 'python-data',
      description: 'Python with httpx',
      resources: { cpu: 2, memory: 4, disk: 10 },
      networking: { networkBlockAll: false, domainAllowList: 'api.example.com' },
    },
    createdBySubject: {
      subjectId: 'user-1',
      subjectType: 'user',
      subjectDisplayName: 'alice',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
];

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  window.history.replaceState(null, '', '/environments');
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  if (originalShowModal === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  }
  if (originalClose === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  }
});

function defaultPermissions(environments: SandboxEnvironment[]): PermissionsServer {
  const ownerGrants = Object.fromEntries(
    environments
      .filter(environment => environment.createdBySubject.subjectId === 'user-1')
      .map(environment => [environment.id, ['MANAGE', 'DELETE'] as const]),
  );
  return {
    listPermissions: vi.fn(
      async ({ resourceType, resourceIds }: ListPermissionsRequest): Promise<ListPermissionsResponse> => {
        if (resourceType === 'tenant') {
          return {
            data: {
              type: 'tenant',
              permissions: { agent: ['CREATE'], sandbox_environment: ['CREATE'] },
            },
          };
        }
        if (resourceType === 'sandbox_environment') {
          return {
            data: {
              type: 'sandbox_environment',
              permissions: Object.fromEntries(resourceIds.map(id => [id, [...(ownerGrants[id] ?? [])]])),
            },
          };
        }
        return { data: { type: resourceType, permissions: {} } };
      },
    ),
  };
}

function renderPage({
  environments = sampleEnvironments,
  environmentOverrides = {},
  currentUser = { subjectId: 'user-1', displayName: 'alice' },
  permissions,
  track,
}: {
  environments?: SandboxEnvironment[];
  environmentOverrides?: Partial<SandboxEnvironmentServer>;
  currentUser?: CurrentUser;
  permissions?: PermissionsServer;
  track?: TrackAnalytics;
} = {}) {
  const environmentServer = createMockSandboxEnvironmentServer({
    listEnvironments: vi.fn(async () => ({ data: environments })),
    ...environmentOverrides,
  });
  const server = createMockAgentUIServer({
    catalog: createMockCatalog(),
    sandboxEnvironments: environmentServer,
    permissions: permissions ?? defaultPermissions(environments),
  });

  const tree = (
    <ServerProvider server={server}>
      <CurrentUserProvider currentUser={currentUser}>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
          <ToasterProvider>
            <EnvironmentsPage />
          </ToasterProvider>
        </ShellModeProvider>
      </CurrentUserProvider>
    </ServerProvider>
  );
  return render(track != null ? <AnalyticsProvider track={track}>{tree}</AnalyticsProvider> : tree);
}

describe('EnvironmentsPage', () => {
  it('lists environments without calling sandbox providers', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('python-data')).toBeInTheDocument();
    });
    expect(screen.getByText('Python with httpx')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('2 vCPU · 4 GB RAM · 10 GB disk')).toBeInTheDocument();
    expect(screen.getByText('1 allowed domain')).toBeInTheDocument();
  });

  it('shows a friendly load error instead of raw fetch failures', async () => {
    renderPage({
      environmentOverrides: {
        listEnvironments: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      },
    });

    expect(await screen.findByRole('heading', { name: "Couldn't load environments" })).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load environments')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('opens create drawer from New Environment', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Environment/i })).toBeEnabled();
    });
    screen.getByRole('button', { name: /New Environment/i }).click();
    await waitFor(() => {
      expect(screen.getByText('New environment')).toBeInTheDocument();
    });
  });

  it('opens create drawer from envIsNew only after CREATE is granted', async () => {
    window.history.replaceState(null, '', '/environments?envIsNew=true');
    renderPage();
    expect(await screen.findByRole('heading', { name: 'New environment' })).toBeInTheDocument();
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('envIsNew')).toBeNull();
    });
  });

  it('does not open create drawer from envIsNew when CREATE is denied', async () => {
    window.history.replaceState(null, '', '/environments?envIsNew=true');
    let resolveTenant: ((value: ListPermissionsResponse) => void) | undefined;
    renderPage({
      permissions: {
        listPermissions: vi.fn(async ({ resourceType }): Promise<ListPermissionsResponse> => {
          if (resourceType !== 'tenant') {
            return { data: { type: resourceType, permissions: {} } };
          }
          return new Promise(resolve => {
            resolveTenant = resolve;
          });
        }),
      },
    });

    expect(screen.queryByRole('heading', { name: 'New environment' })).not.toBeInTheDocument();

    await act(async () => {
      resolveTenant?.({
        data: { type: 'tenant', permissions: { agent: ['CREATE'], sandbox_environment: [] } },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New Environment/i })).toBeDisabled();
    });
    expect(screen.queryByRole('heading', { name: 'New environment' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('envIsNew')).toBeNull();
    });
  });

  it('greys out every action when list-permissions grants none, explaining why on hover', async () => {
    renderPage({
      environments: [
        {
          ...sampleEnvironments[0]!,
          createdBySubject: {
            subjectId: 'user-2',
            subjectType: 'user',
            subjectDisplayName: 'bob',
          },
        },
      ],
      permissions: {
        listPermissions: vi.fn(async ({ resourceType }): Promise<ListPermissionsResponse> =>
          resourceType === 'tenant'
            ? {
                data: {
                  type: 'tenant',
                  permissions: { agent: ['CREATE'], sandbox_environment: ['CREATE'] },
                },
              }
            : { data: { type: 'sandbox_environment', permissions: { e1: [] } } },
        ),
      },
    });

    const name = await screen.findByText('python-data');
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    for (const label of ['Edit', 'Set as default', 'Disable', 'Delete']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeDisabled();
    }

    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    fireEvent.mouseEnter(edit.parentElement ?? edit);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('You do not have permission to manage');

    fireEvent.click(name);
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('greys out Set as default when tenant CREATE is denied even if MANAGE is granted', async () => {
    renderPage({
      permissions: {
        listPermissions: vi.fn(async ({ resourceType }): Promise<ListPermissionsResponse> =>
          resourceType === 'tenant'
            ? { data: { type: 'tenant', permissions: { agent: ['CREATE'], sandbox_environment: [] } } }
            : { data: { type: 'sandbox_environment', permissions: { e1: ['MANAGE', 'DELETE'] } } },
        ),
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeEnabled();
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeEnabled();
    });

    const setDefault = screen.getByRole('menuitem', { name: 'Set as default' });
    expect(setDefault).toBeDisabled();
    fireEvent.mouseEnter(setDefault.parentElement ?? setDefault);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Only admins can choose the default environment');
  });

  it('disables New Environment without tenant sandbox_environment CREATE', async () => {
    renderPage({
      permissions: {
        listPermissions: vi.fn(async ({ resourceType }): Promise<ListPermissionsResponse> =>
          resourceType === 'tenant'
            ? { data: { type: 'tenant', permissions: { agent: ['CREATE'], sandbox_environment: [] } } }
            : { data: { type: 'sandbox_environment', permissions: { e1: [] } } },
        ),
      },
    });

    expect(await screen.findByRole('button', { name: /New Environment/i })).toBeDisabled();
  });

  it('polls pending environments using getEnvironment in the background', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pendingEnv = {
      id: 'env-1',
      name: 'building-env',
      description: '',
      status: 'pending' as const,
      enabled: true,
      isDefault: false,
      statusReason: null,
      manifest: { name: 'building-env' },
      createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-01T10:00:00Z',
    };
    const listEnvironments = vi.fn(async () => ({
      data: [pendingEnv],
    }));
    const getEnvironment = vi.fn(async () => ({
      ...pendingEnv,
      status: 'ready' as const,
    }));

    try {
      renderPage({ environmentOverrides: { listEnvironments, getEnvironment } });
      await waitFor(() => {
        expect(screen.getByText('building-env')).toBeInTheDocument();
      });

      expect(getEnvironment).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(PENDING_ENVIRONMENTS_POLL_INTERVAL_MS);
      });

      expect(getEnvironment).toHaveBeenCalledWith({ name: 'building-env' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists environments when sandbox provider listing is forbidden', async () => {
    const listSandboxProviders = vi.fn(async () => {
      throw new Error('Forbidden');
    });
    const environmentServer = createMockSandboxEnvironmentServer({
      listEnvironments: vi.fn(async () => ({ data: sampleEnvironments })),
    });
    const catalog = createMockCatalog({
      sandboxCatalog: {
        getSandboxProviderCatalog: async () => [],
        listSandboxProviders,
        createSandboxProvider: vi.fn(),
        updateSandboxProvider: vi.fn(),
      },
    });
    const server = createMockAgentUIServer({
      catalog,
      sandboxEnvironments: environmentServer,
    });

    render(
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
          <ToasterProvider>
            <EnvironmentsPage />
          </ToasterProvider>
        </ShellModeProvider>
      </ServerProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('python-data')).toBeInTheDocument();
    });
    expect(listSandboxProviders).not.toHaveBeenCalled();
  });

  it('tracks environment deleted after confirm', async () => {
    const deleteEnvironment = vi.fn(async () => {});
    const track = vi.fn();
    renderPage({ environmentOverrides: { deleteEnvironment }, track });
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    Object.defineProperty(dialog, 'close', {
      configurable: true,
      value() {
        (this as HTMLDialogElement).open = false;
        this.dispatchEvent(new Event('close'));
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteEnvironment).toHaveBeenCalledWith({ name: 'python-data' }));
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Environment.DELETED, {
      environment_name: 'python-data',
      environment_id: 'e1',
    });
  });

  it('disables an environment and marks another as the default', async () => {
    const setEnvironmentEnabled = vi.fn(async () => sampleEnvironments[0]!);
    const setDefaultEnvironment = vi.fn(async () => sampleEnvironments[0]!);
    renderPage({ environmentOverrides: { setEnvironmentEnabled, setDefaultEnvironment } });

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set as default' }));
    await waitFor(() => expect(setDefaultEnvironment).toHaveBeenCalledWith({ name: 'python-data' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));
    await waitFor(() => expect(setEnvironmentEnabled).toHaveBeenCalledWith({ name: 'python-data', enabled: false }));
  });

  it('badges the default environment and greys out Disable, Set as default, and Delete', async () => {
    renderPage({
      environments: [{ ...sampleEnvironments[0]!, isDefault: true }],
    });

    const badge = await screen.findByText('Default');
    expect(badge).toBeInTheDocument();
    fireEvent.mouseEnter(badge);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Agents that do not pick an environment run in this one.');
    fireEvent.mouseLeave(badge);

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeEnabled();

    const disable = screen.getByRole('menuitem', { name: 'Disable' });
    expect(disable).toBeDisabled();
    fireEvent.mouseEnter(disable.parentElement ?? disable);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('The default environment cannot be disabled');
    fireEvent.mouseLeave(disable.parentElement ?? disable);

    const setDefault = screen.getByRole('menuitem', { name: 'Set as default' });
    expect(setDefault).toBeDisabled();
    fireEvent.mouseEnter(setDefault.parentElement ?? setDefault);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Already the default');
    fireEvent.mouseLeave(setDefault.parentElement ?? setDefault);

    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    expect(remove).toBeDisabled();
    fireEvent.mouseEnter(remove.parentElement ?? remove);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('The default environment cannot be deleted');
  });

  it('greys out Disable on the default environment', async () => {
    const setEnvironmentEnabled = vi.fn(async () => sampleEnvironments[0]!);
    renderPage({
      environments: [{ ...sampleEnvironments[0]!, isDefault: true }],
      environmentOverrides: { setEnvironmentEnabled },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    const disable = screen.getByRole('menuitem', { name: 'Disable' });
    expect(disable).toBeDisabled();
    fireEvent.mouseEnter(disable.parentElement ?? disable);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'The default environment cannot be disabled. Make another one the default first.',
    );
    expect(setEnvironmentEnabled).not.toHaveBeenCalled();
  });

  it('opens the edit drawer from the actions menu', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Save')).toBeInTheDocument();
  });

  it('greys out Edit and Delete on a platform-provisioned environment', async () => {
    renderPage({ environments: [{ ...sampleEnvironments[0]!, name: 'trueforge-sandbox-env' }] });

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for trueforge-sandbox-env' }));
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeEnabled();

    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    expect(edit).toBeDisabled();
    fireEvent.mouseEnter(edit.parentElement ?? edit);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('cannot be edited');
    fireEvent.mouseLeave(edit.parentElement ?? edit);

    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    expect(remove).toBeDisabled();
    fireEvent.mouseEnter(remove.parentElement ?? remove);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('cannot be deleted');
  });

  it('badges a disabled environment and greys out Set as default until it is enabled', async () => {
    renderPage({
      environments: [{ ...sampleEnvironments[0]!, enabled: false }],
    });

    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    expect(screen.getByRole('menuitem', { name: 'Enable' })).toBeEnabled();

    const setDefault = screen.getByRole('menuitem', { name: 'Set as default' });
    expect(setDefault).toBeDisabled();
    fireEvent.mouseEnter(setDefault.parentElement ?? setDefault);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Enable the environment before making it the default');
  });

  it('shows an error toast when delete fails after closing the confirm dialog', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const httpError = Object.assign(new Error('Status code: 409'), {
      statusCode: 409,
      body: { error: { message: 'Environment is still referenced by an agent' } },
    });
    const deleteEnvironment = vi.fn(async () => {
      throw httpError;
    });
    renderPage({ environmentOverrides: { deleteEnvironment } });
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for python-data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteEnvironment).toHaveBeenCalledWith({ name: 'python-data' }));
    expect(await screen.findByText('Request failed (409)')).toBeInTheDocument();
    expect(screen.getByText('Environment is still referenced by an agent')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('EnvironmentsButton', () => {
  it('tracks page opened when opening environments', async () => {
    const track = vi.fn();
    const server = createMockAgentUIServer({
      catalog: createMockCatalog(),
      sandboxEnvironments: createMockSandboxEnvironmentServer(),
    });

    render(
      <AnalyticsProvider track={track}>
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
            <EnvironmentsButton />
          </ShellModeProvider>
        </ServerProvider>
      </AnalyticsProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Environments' }));
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Environment.PAGE_OPENED, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Environments' }));
    expect(track).toHaveBeenCalledTimes(1);
  });
});
