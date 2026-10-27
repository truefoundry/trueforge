'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect } from 'react';

import { readSandboxEnvironmentName, sandboxWithEnvironmentName } from '../../server/draftSpecPreferences.js';
import { useReadySandboxEnvironments } from './useReadySandboxEnvironments.js';

/**
 * Resets a remembered sandbox environment that no longer exists to `default` before the first
 * turn. Mounted with the composer so it runs on page load, not only when the config drawer opens.
 */
export function useFallbackMissingSandboxEnvironment(): void {
  const { agentSpec, draftSessionId } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const { environments, loaded, loading, error } = useReadySandboxEnvironments();

  const sandbox = agentSpec?.config?.sandbox;
  const name = readSandboxEnvironmentName(sandbox);
  const missing =
    draftSessionId == null &&
    loaded &&
    !loading &&
    error === null &&
    name !== 'default' &&
    !environments.some(env => env.name === name);

  useEffect(() => {
    if (!missing) return;
    updateAgentSpec?.({
      config: { ...agentSpec?.config, sandbox: sandboxWithEnvironmentName(sandbox, undefined) },
    });
    // Only react to the missing-environment transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);
}
