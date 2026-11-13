'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect } from 'react';

import { readSandboxEnvironmentName, sandboxWithEnvironmentName } from '../../server/draftSpecPreferences.js';
import {
  useOptionalSandboxEnvironmentServer,
  useServerCapabilities,
  useServerCapabilitiesSettled,
} from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { useSandboxEnvironments } from './useSandboxEnvironments.js';

export type ResolveDraftSandboxEnvironmentResult = {
  /**
   * False while a new-chat/agent draft still needs the environments catalog (or the
   * follow-up pin of the tenant default) before createSession can include environment_name.
   * Named / Try Agent composers stay true — they do not send an inline draft spec.
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
  const shell = useOptionalShellMode();
  const capabilities = useServerCapabilities();
  const capabilitiesSettled = useServerCapabilitiesSettled();
  const environmentServer = useOptionalSandboxEnvironmentServer();
  const { environments, defaultEnvironment, loaded, loading, error } = useSandboxEnvironments();

  // Named / immutable chats send agentName, not an inline draft — never gate them.
  const isMutableDraft =
    agentSpec != null && (shell == null || (shell.mode.status === 'active' && shell.mode.isMutable));

  const sandbox = agentSpec?.config?.sandbox;
  const name = readSandboxEnvironmentName(sandbox);
  const settled = isMutableDraft && draftSessionId == null && loaded && !loading && error === null;
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

  if (!isMutableDraft || draftSessionId != null) {
    return { readyForSend: true };
  }

  const environmentsRequired = environmentServer != null && capabilities?.sandbox?.environments?.enabled === true;
  // Only the live draft flag matters — capability alone must not hold send when sandbox is off.
  const sandboxWanted = sandbox?.enabled === true;
  const needsEnvironment = sandboxWanted && environmentsRequired;

  let readyForSend = true;
  if (environmentServer != null && !capabilitiesSettled) {
    // Capabilities decide whether environments are required; hold until that is known.
    readyForSend = false;
  } else if (needsEnvironment) {
    if (name !== undefined) {
      // Already pinned — allow send even while a refetch is in flight or the catalog errored.
      readyForSend = true;
    } else if (error != null) {
      // Do not block forever on a failed list; createSession will 422 if still missing a name.
      readyForSend = true;
    } else if (!loaded || loading) {
      // Catalog still in flight — hold send so createSession is not missing environment_name.
      readyForSend = false;
    } else if (defaultEnvironment?.enabled === true) {
      // Catalog arrived; wait one more turn for the pin effect to write the default name.
      readyForSend = false;
    }
  }

  return { readyForSend };
}
