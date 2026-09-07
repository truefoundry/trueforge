'use client';

import { useTrueFoundryAgentSpec, useTrueFoundryUpdateAgentSpec } from '@truefoundry/assistant-ui-runtime';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { useDebouncedAgentInstructions } from '../../hooks/useDebouncedAgentInstructions.js';

type AgentConfigInstructionsContextValue = {
  draft: string;
  onChange: (value: string) => void;
  flush: () => void;
};

const AgentConfigInstructionsContext = createContext<AgentConfigInstructionsContextValue | null>(null);

export function AgentConfigInstructionsProvider({ children }: { children: ReactNode }) {
  const { agentSpec } = useTrueFoundryAgentSpec();
  const updateAgentSpec = useTrueFoundryUpdateAgentSpec();
  const commit = useCallback((instructions: string) => updateAgentSpec?.({ instructions }), [updateAgentSpec]);
  const { draft, onChange, flush } = useDebouncedAgentInstructions({
    value: agentSpec?.instructions ?? '',
    onCommit: commit,
  });
  const value = useMemo(() => ({ draft, onChange, flush }), [draft, flush, onChange]);

  return <AgentConfigInstructionsContext.Provider value={value}>{children}</AgentConfigInstructionsContext.Provider>;
}

export function useAgentConfigInstructions(): AgentConfigInstructionsContextValue {
  const value = useContext(AgentConfigInstructionsContext);
  if (value === null) {
    throw new Error('useAgentConfigInstructions must be used within AgentConfigInstructionsProvider');
  }
  return value;
}

export function useOptionalAgentConfigInstructions(): AgentConfigInstructionsContextValue | null {
  return useContext(AgentConfigInstructionsContext);
}
