// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useReadySandboxEnvironments } from '@/atoms/environments/useReadySandboxEnvironments.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { SandboxEnvironment } from '@/server/types.js';
import { createMockAgentUIServer, createMockSandboxEnvironmentServer } from '../../server/mockServer.js';

const readyEnv: SandboxEnvironment = {
  id: 'e1',
  name: 'python-data',
  description: 'Python',
  status: 'ready',
  statusReason: null,
  manifest: { name: 'python-data', description: 'Python' },
  createdBySubject: {
    subjectId: 'user-1',
    subjectType: 'user',
    subjectDisplayName: 'alice',
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

const pendingEnv: SandboxEnvironment = {
  ...readyEnv,
  id: 'e2',
  name: 'pending-env',
  status: 'pending',
  manifest: { name: 'pending-env', description: 'Building' },
};

describe('useReadySandboxEnvironments', () => {
  it('filters to ready environments and refetches when the catalog epoch bumps', async () => {
    const listEnvironments = vi
      .fn()
      .mockResolvedValueOnce({ data: [readyEnv, pendingEnv] })
      .mockResolvedValueOnce({
        data: [
          readyEnv,
          { ...pendingEnv, status: 'ready' as const },
          {
            ...readyEnv,
            id: 'e3',
            name: 'new-ready',
            status: 'ready' as const,
            manifest: { name: 'new-ready', description: 'New' },
          },
        ],
      });
    const server = createMockAgentUIServer({
      sandboxEnvironments: createMockSandboxEnvironmentServer({ listEnvironments }),
    });

    function wrapper({ children }: { children: ReactNode }) {
      return (
        <ServerProvider server={server}>
          <ShellModeProvider>{children}</ShellModeProvider>
        </ServerProvider>
      );
    }

    const { result } = renderHook(
      () => ({
        ready: useReadySandboxEnvironments(),
        shell: useShellMode(),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.ready.loading).toBe(false);
    });
    expect(result.current.ready.environments.map(e => e.name)).toEqual(['python-data']);
    expect(listEnvironments).toHaveBeenCalledTimes(1);

    act(() => result.current.shell.invalidateEnvironmentsList());

    await waitFor(() => {
      expect(listEnvironments).toHaveBeenCalledTimes(2);
      expect(result.current.ready.loading).toBe(false);
      expect(result.current.ready.environments.map(e => e.name).sort()).toEqual([
        'new-ready',
        'pending-env',
        'python-data',
      ]);
    });
  });

  it('drains multiple pages of environments using limit: 1000', async () => {
    const page1Env = { ...readyEnv, id: 'e1', name: 'env-page-1' };
    const page2Env = { ...readyEnv, id: 'e2', name: 'env-page-2' };
    const listEnvironments = vi
      .fn()
      .mockResolvedValueOnce({ data: [page1Env], nextPageToken: 'token-page-2' })
      .mockResolvedValueOnce({ data: [page2Env] });

    const server = createMockAgentUIServer({
      sandboxEnvironments: createMockSandboxEnvironmentServer({ listEnvironments }),
    });

    function wrapper({ children }: { children: ReactNode }) {
      return (
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>{children}</ShellModeProvider>
        </ServerProvider>
      );
    }

    const { result } = renderHook(() => useReadySandboxEnvironments(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(listEnvironments).toHaveBeenCalledTimes(2);
    expect(listEnvironments).toHaveBeenNthCalledWith(1, { limit: 1000, pageToken: undefined });
    expect(listEnvironments).toHaveBeenNthCalledWith(2, { limit: 1000, pageToken: 'token-page-2' });
    expect(result.current.environments.map(e => e.name)).toEqual(['env-page-1', 'env-page-2']);
  });
});
