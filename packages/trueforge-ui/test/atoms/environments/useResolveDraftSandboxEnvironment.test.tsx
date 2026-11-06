// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResolveDraftSandboxEnvironment } from '@/atoms/environments/useResolveDraftSandboxEnvironment.js';
import { useSandboxEnvironments } from '@/atoms/environments/useSandboxEnvironments.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type { AgentSpec, SandboxEnvironment } from '@/server/types.js';
import { createMockAgentUIServer, createMockSandboxEnvironmentServer } from '../../server/mockServer.js';

let agentSpec: AgentSpec;
let draftSessionId: string | undefined;
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
  useTrueForgeAgentSpec: () => ({ agentSpec, draftSessionId }),
  useTrueForgeUpdateAgentSpec: () => updateAgentSpec,
}));

const readyEnv: SandboxEnvironment = {
  id: 'e1',
  name: 'python-data',
  description: 'Python',
  status: 'ready',
  enabled: true,
  isDefault: false,
  statusReason: null,
  manifest: { name: 'python-data', description: 'Python' },
  createdBySubject: { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'alice' },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};
const defaultEnv: SandboxEnvironment = {
  ...readyEnv,
  id: 'e2',
  name: 'team-base',
  isDefault: true,
  manifest: { name: 'team-base', description: 'Team base' },
};

function renderResolve(environments: SandboxEnvironment[]) {
  const server = createMockAgentUIServer({
    sandboxEnvironments: createMockSandboxEnvironmentServer({
      listEnvironments: async () => ({ data: environments }),
    }),
  });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerProvider server={server}>
        <ShellModeProvider>{children}</ShellModeProvider>
      </ServerProvider>
    );
  }
  // The sibling loader exposes when the catalog has arrived, so "no update" assertions
  // cannot pass merely by running before the resolver had any data.
  return renderHook(
    () => {
      useResolveDraftSandboxEnvironment();
      return useSandboxEnvironments();
    },
    { wrapper },
  );
}

async function renderResolved(environments: SandboxEnvironment[]) {
  const { result } = renderResolve(environments);
  await waitFor(() => {
    expect(result.current.loaded).toBe(true);
  });
}

describe('useResolveDraftSandboxEnvironment', () => {
  beforeEach(() => {
    updateAgentSpec.mockClear();
    draftSessionId = undefined;
    agentSpec = { model: { name: 'gpt-4' } };
  });

  it('pins a draft that names no environment to the tenant default', async () => {
    renderResolve([readyEnv, defaultEnv]);

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({
        config: { sandbox: { environmentName: 'team-base' } },
      });
    });
  });

  it('leaves an environment the user already picked alone', async () => {
    agentSpec = { model: { name: 'gpt-4' }, config: { sandbox: { enabled: true, environmentName: 'python-data' } } };
    await renderResolved([readyEnv, defaultEnv]);

    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('repoints a remembered environment that left the catalog to the default', async () => {
    agentSpec = { model: { name: 'gpt-4' }, config: { sandbox: { enabled: true, environmentName: 'gone-env' } } };
    renderResolve([readyEnv, defaultEnv]);

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({
        config: { sandbox: { enabled: true, environmentName: 'team-base' } },
      });
    });
  });

  it('repoints a picked environment that an admin has disabled to the default', async () => {
    agentSpec = { model: { name: 'gpt-4' }, config: { sandbox: { enabled: true, environmentName: 'python-data' } } };
    renderResolve([{ ...readyEnv, enabled: false }, defaultEnv]);

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({
        config: { sandbox: { enabled: true, environmentName: 'team-base' } },
      });
    });
  });

  it('keeps a picked environment that is still building', async () => {
    agentSpec = { model: { name: 'gpt-4' }, config: { sandbox: { enabled: true, environmentName: 'python-data' } } };
    await renderResolved([{ ...readyEnv, status: 'pending' }, defaultEnv]);

    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('keeps a picked environment whose last build failed', async () => {
    agentSpec = { model: { name: 'gpt-4' }, config: { sandbox: { enabled: true, environmentName: 'python-data' } } };
    await renderResolved([{ ...readyEnv, status: 'failed' }, defaultEnv]);

    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('pins a default that is still building', async () => {
    renderResolve([readyEnv, { ...defaultEnv, status: 'pending' }]);

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({
        config: { sandbox: { environmentName: 'team-base' } },
      });
    });
  });

  it('leaves a draft already naming the still-building default alone', async () => {
    agentSpec = { model: { name: 'gpt-4' }, config: { sandbox: { enabled: true, environmentName: 'team-base' } } };
    await renderResolved([readyEnv, { ...defaultEnv, status: 'pending' }]);

    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('names nothing when the tenant has no default', async () => {
    await renderResolved([readyEnv]);

    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('leaves a started chat alone', async () => {
    draftSessionId = 'session-1';
    await renderResolved([readyEnv, defaultEnv]);

    expect(updateAgentSpec).not.toHaveBeenCalled();
  });
});
