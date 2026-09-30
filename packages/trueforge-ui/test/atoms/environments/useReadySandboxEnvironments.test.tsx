// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useReadySandboxEnvironments } from '@/atoms/environments/useReadySandboxEnvironments.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { SandboxEnvironment } from '@/server/types.js';
import { createMockAgentUIServer, createMockSandboxEnvironmentServer } from '../../server/mockServer.js';

const activeEnv: SandboxEnvironment = {
  id: 'e1',
  name: 'python-data',
  description: 'Python',
  status: 'active',
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
  ...activeEnv,
  id: 'e2',
  name: 'pending-env',
  status: 'pending',
  manifest: { name: 'pending-env', description: 'Building' },
};

describe('useReadySandboxEnvironments', () => {
  it('filters to active environments and refetches when the catalog epoch bumps', async () => {
    const listEnvironments = vi
      .fn()
      .mockResolvedValueOnce({ data: [activeEnv, pendingEnv] })
      .mockResolvedValueOnce({
        data: [
          activeEnv,
          { ...pendingEnv, status: 'active' as const },
          {
            ...activeEnv,
            id: 'e3',
            name: 'new-active',
            status: 'active' as const,
            manifest: { name: 'new-active', description: 'New' },
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
        'new-active',
        'pending-env',
        'python-data',
      ]);
    });
  });
});
