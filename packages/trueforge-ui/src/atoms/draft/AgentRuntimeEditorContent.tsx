'use client';

import type { AgentSpec } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';

export type AgentRuntimeEditorContentProps = {
  spec: AgentSpec;
  sandboxAvailable: boolean;
  onChange: (spec: AgentSpec) => void;
};

export function AgentRuntimeEditorContent({ spec, sandboxAvailable, onChange }: AgentRuntimeEditorContentProps) {
  const AgentRuntimeConfigFields = useSlot('AgentRuntimeConfigFields');

  return (
    <div className="h-[min(38rem,calc(100dvh-8rem))] w-full overflow-y-auto p-5">
      <AgentRuntimeConfigFields
        value={spec.config ?? {}}
        sandboxAvailable={sandboxAvailable}
        hasSkills={(spec.skills?.length ?? 0) > 0}
        layout="detailed"
        onChange={config => onChange({ ...spec, config })}
      />
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentRuntimeEditorContent: typeof AgentRuntimeEditorContent;
  }
}
