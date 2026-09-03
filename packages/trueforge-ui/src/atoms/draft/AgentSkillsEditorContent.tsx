'use client';

import { Icon } from '../../icons/Icon.js';
import type { AgentSkill, AgentSpec } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { editableMountsFromSpec } from './agentConfigMounts.js';

export type AgentSkillsEditorContentProps = {
  spec: AgentSpec;
  skills: AgentSkill[];
  skillsDisabled: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (spec: AgentSpec) => void;
};

export function AgentSkillsEditorContent({
  spec,
  skills,
  skillsDisabled,
  query,
  onQueryChange,
  onChange,
}: AgentSkillsEditorContentProps) {
  const CatalogRow = useSlot('CatalogRow');
  const skillMounts = editableMountsFromSpec(spec.skills);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSkills = skills
    .filter(item => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftSelected = skillMounts.some(item => item.id === left.id || item.name === left.name);
      const rightSelected = skillMounts.some(item => item.id === right.id || item.name === right.name);
      return Number(rightSelected) - Number(leftSelected);
    });

  return (
    <div className="flex h-[min(32rem,calc(100dvh-8rem))] w-full min-w-0 flex-col overflow-hidden">
      <label className="relative m-3 block shrink-0">
        <Icon name="search" className="text-text-secondary absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <input
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="Search skills"
          className={auiInputClass('h-9 w-full pl-7')}
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filteredSkills.map(skill => {
          const mount = skillMounts.find(item => item.id === skill.id || item.name === skill.name);
          return (
            <CatalogRow
              key={skill.id}
              title={skill.name}
              description={skill.description}
              checked={mount !== undefined}
              disabled={skillsDisabled && mount === undefined}
              onToggle={() => {
                const adding = mount === undefined;
                onChange({
                  ...spec,
                  skills: adding
                    ? [...(spec.skills ?? []), { id: skill.id, name: skill.name }]
                    : skillMounts.filter(item => item !== mount).map(item => item.value),
                  ...(adding
                    ? {
                        config: {
                          ...spec.config,
                          sandbox: { ...spec.config?.sandbox, enabled: true },
                        },
                      }
                    : {}),
                });
              }}
            />
          );
        })}
        {filteredSkills.length === 0 ? (
          <p className="text-text-secondary p-4 text-center text-sm">No skills found.</p>
        ) : null}
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentSkillsEditorContent: typeof AgentSkillsEditorContent;
  }
}
