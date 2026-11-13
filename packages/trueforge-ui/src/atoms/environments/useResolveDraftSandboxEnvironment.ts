'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect } from 'react';

import { readSandboxEnvironmentName, sandboxWithEnvironmentName } from '../../server/draftSpecPreferences.js';
import { isEnvironmentsChromeEnabled } from '../../server/serverChrome.js';
import { useOptionalSandboxEnvironmentServer, useServerCapabilities } from '../../server/ServerContext.js';
import { useSandboxEnvironments } from './useSandboxEnvironments.js';

export type UseResolveDraftSandboxEnvironmentResult = {
  /**
   * True while environments chrome is on and this draft still needs a pinned
   * environment name — list in flight, or pin write not yet applied.
   */
  pending: boolean;
};

/**
 * Pins a fresh draft to a concrete environment: the tenant default when the draft names none,
 * and again when a remembered name has left the catalog or been disabled. Resolving here rather
 * than leaving the name empty means the choice is fixed at creation and a later change of default
 * does not move a chat or agent that was already started.
 *
 * Mounted with the composer so it runs on page load, not only when the config drawer opens.
 * Exposes `pending` so Send can wait for the pin without blocking when the feature is off,
 * the list failed, or the tenant has no default.
 */
export function useResolveDraftSandboxEnvironment(): UseResolveDraftSandboxEnvironmentResult {
  const { agentSpec, draftSessionId } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const sandboxEnvironments = useOptionalSandboxEnvironmentServer();
  const capabilities = useServerCapabilities();
  const { environments, defaultEnvironment, loaded, loading, error } = useSandboxEnvironments();

  const sandbox = agentSpec?.config?.sandbox;
  const featureOn = isEnvironmentsChromeEnabled({ sandboxEnvironments, capabilities }) && sandbox?.enabled !== false;
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

  const pending = featureOn && draftSessionId == null && (loading || (!loaded && error === null) || resolve);

  return { pending };
}
