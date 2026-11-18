'use client';

import { useTrueForgeAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect } from 'react';

import { useShellMode } from '../../server/ShellModeContext.js';
import { hasAgentSpecEdits } from '../lib/hasAgentSpecEdits.js';
import { useOptionalAgentConfigInstructions } from './AgentConfigInstructionsContext.js';

/**
 * The live spec lives inside the chat runtime but navigation lives in the shell, so this
 * reports whether the builder has edits that were never saved to the agent.
 */
export function UnsavedAgentChangesBridge() {
  const { mode, setHasUnsavedAgentChanges } = useShellMode();
  const { agentSpec, isSpecLoading } = useTrueForgeAgentSpec();
  const instructions = useOptionalAgentConfigInstructions();

  const saved = mode.status === 'active' && mode.isMutable && mode.isCreateAgent ? mode.agentSpec : undefined;
  // Instructions are debounced into the spec, so a just-typed edit only exists in the draft.
  const live =
    agentSpec != null && instructions != null ? { ...agentSpec, instructions: instructions.draft } : agentSpec;
  const dirty = saved != null && live != null && !isSpecLoading && hasAgentSpecEdits({ saved, live });

  useEffect(() => {
    setHasUnsavedAgentChanges(dirty);
    // When the builder unmounts (remount on New Agent / Try), nothing is left to warn about.
    return () => setHasUnsavedAgentChanges(false);
  }, [dirty, setHasUnsavedAgentChanges]);

  return null;
}
