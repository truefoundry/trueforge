'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect } from 'react';

import { readSandboxEnvironmentName, sandboxWithEnvironmentName } from '../../server/draftSpecPreferences.js';
import { useSandboxEnvironments } from './useSandboxEnvironments.js';

/**
 * Pins a fresh draft to a concrete environment: the tenant default when the draft names none,
 * and again when a remembered name has left the catalog or been disabled. Resolving here rather
 * than leaving the name empty means the choice is fixed at creation and a later change of default
 * does not move a chat or agent that was already started.
 *
 * Mounted with the composer so it runs on page load, not only when the config drawer opens.
 */
export function useResolveDraftSandboxEnvironment(): void {
  const { agentSpec, draftSessionId } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const { environments, defaultEnvironment, loaded, loading, error } = useSandboxEnvironments();

  const sandbox = agentSpec?.config?.sandbox;
  const name = readSandboxEnvironmentName(sandbox);
  const settled = draftSessionId == null && loaded && !loading && error === null;
  // A building or failed environment is still the user's own choice and will come back, so the
  // name survives. Disabled is different: the write path refuses it, so keeping it would dead-end
  // every new chat until the picker is changed by hand.
  const usable = environments.some(env => env.name === name && env.enabled);
  const target = defaultEnvironment?.name;
  // Clearing an unknown name is still worth doing when the tenant has no default.
  const resolve = settled && !usable && target !== name && (target !== undefined || name !== undefined);

  useEffect(() => {
    if (!resolve) return;
    updateAgentSpec?.({
      config: { ...agentSpec?.config, sandbox: sandboxWithEnvironmentName(sandbox, target) },
    });
    // Only react to the unresolved-environment transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve, target]);
}
