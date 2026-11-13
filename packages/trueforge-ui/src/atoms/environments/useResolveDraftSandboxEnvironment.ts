'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect } from 'react';

import { readSandboxEnvironmentName, sandboxWithEnvironmentName } from '../../server/draftSpecPreferences.js';
import {
  useOptionalSandboxEnvironmentServer,
  useServerCapabilities,
  useServerCapabilitiesSettled,
} from '../../server/ServerContext.js';
import { useSandboxEnvironments } from './useSandboxEnvironments.js';

export type ResolveDraftSandboxEnvironmentResult = {
  /**
   * False while a new-chat/agent draft still needs the environments catalog (or the
   * follow-up pin of the tenant default) before createSession can include environment_name.
   */
  readyForSend: boolean;
};

/**
 * Pins a fresh draft to a concrete environment: the tenant default when the draft names none,
 * and again when a remembered name has left the catalog or been disabled. Resolving here rather
 * than leaving the name empty means the choice is fixed at creation and a later change of default
 * does not move a chat or agent that was already started.
 *
 * Mounted with the composer so it runs on page load, not only when the config drawer opens.
 * Callers should hold send until `readyForSend` so automation cannot race the pin.
 */
export function useResolveDraftSandboxEnvironment(): ResolveDraftSandboxEnvironmentResult {
  const { agentSpec, draftSessionId } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const capabilities = useServerCapabilities();
  const capabilitiesSettled = useServerCapabilitiesSettled();
  const environmentServer = useOptionalSandboxEnvironmentServer();
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

  const environmentsRequired = environmentServer != null && capabilities?.sandbox?.environments?.enabled === true;
  const sandboxWanted =
    sandbox?.enabled === true || (draftSessionId == null && capabilities?.sandbox?.enabled === true);
  const needsEnvironment = draftSessionId == null && sandboxWanted && environmentsRequired;

  let readyForSend = true;
  if (draftSessionId == null && environmentServer != null && !capabilitiesSettled) {
    // Capabilities decide whether environments are required; hold until that is known.
    readyForSend = false;
  } else if (needsEnvironment) {
    if (!loaded || loading) {
      // Catalog still in flight — hold send so createSession is not missing environment_name.
      readyForSend = false;
    } else if (error == null && name === undefined && defaultEnvironment?.enabled === true) {
      // Catalog arrived; wait one more turn for the pin effect to write the default name.
      readyForSend = false;
    }
  }

  return { readyForSend };
}
