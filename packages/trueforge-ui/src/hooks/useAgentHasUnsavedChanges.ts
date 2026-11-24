'use client';

import { useTrueForgeAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect, useState } from 'react';

import { useOptionalAgentConfigInstructions } from '../atoms/draft/AgentConfigInstructionsContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import type { AgentSpec } from '../server/types.js';

// A New Agent draft is patched by preference reconcilers right after it loads, so its
// baseline is the spec once those patches have stopped for this long.
const SEED_SETTLE_MS = 1000;

// Key-order-insensitive form; a missing instructions field equals an empty one.
function canonical(spec: AgentSpec, instructions: string): string {
  return JSON.stringify({ ...spec, instructions }, (_key, value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}

/** True when the builder's live config differs from the saved agent, or from the New Agent seed. */
export function useAgentHasUnsavedChanges(): boolean {
  const shell = useOptionalShellMode();
  const { agentSpec, isSpecLoading } = useTrueForgeAgentSpec();
  const instructionsDraft = useOptionalAgentConfigInstructions()?.draft;
  // Set once the agent is opened or saved, so Save moves the baseline without extra wiring.
  const savedSpec =
    shell?.mode.status === 'active' && shell.mode.agentId !== undefined ? shell.mode.agentSpec : undefined;
  const [seed, setSeed] = useState<AgentSpec | null>(null);
  const seeding = savedSpec === undefined && seed === null && !isSpecLoading;

  useEffect(() => {
    if (!seeding || agentSpec === null) return;
    const timer = setTimeout(() => setSeed(agentSpec), SEED_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [seeding, agentSpec]);

  const baseline = savedSpec ?? seed;
  if (agentSpec === null || baseline === null) return false;
  return (
    canonical(agentSpec, instructionsDraft ?? agentSpec.instructions ?? '') !==
    canonical(baseline, baseline.instructions ?? '')
  );
}
