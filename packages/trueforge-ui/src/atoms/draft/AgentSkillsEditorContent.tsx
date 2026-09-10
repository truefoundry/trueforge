'use client';

import { useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { AgentSkill, AgentSpec } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiInputClass } from '../lib/inputClasses.js';
import { editableMountsFromSpec } from './agentConfigMounts.js';
import {
  SkillVersionSelector,
  skillFamilyId,
  skillRepoName,
  skillVersion,
  type SkillVersionOption,
} from './SkillVersionSelector.js';

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
  const [selectedVersions, setSelectedVersions] = useState<Record<string, SkillVersionOption>>({});
  const skillMounts = editableMountsFromSpec(spec.skills);
  const [initialSelectedFamilies] = useState(() => new Set(skillMounts.map(item => skillFamilyId(item.id))));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSkills = skills
    .filter(item =>
      `${item.name} ${skillRepoName(item) ?? ''} ${item.description ?? ''}`.toLowerCase().includes(normalizedQuery),
    )
    .sort((left, right) => {
      const leftSelected = initialSelectedFamilies.has(skillFamilyId(left.id));
      const rightSelected = initialSelectedFamilies.has(skillFamilyId(right.id));
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
          className={auiInputClass('h-8 w-full pl-7')}
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filteredSkills.map(skill => {
          const mount = skillMounts.find(item => skillFamilyId(item.id) === skillFamilyId(skill.id));
          const selectedVersion = selectedVersions[skill.id];
          const repoName = skillRepoName(skill);
          return (
            <CatalogRow
              key={skill.id}
              title={skill.name}
              description={skill.description}
              badge={
                repoName === undefined ? undefined : (
                  <span className="bg-primary-button-bg/10 text-primary-button-bg shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem]">
                    {repoName}
                  </span>
                )
              }
              checked={mount !== undefined}
              disabled={skillsDisabled && mount === undefined}
              action={
                skillVersion(skill) === undefined ? undefined : (
                  <SkillVersionSelector
                    skill={skill}
                    selectedId={selectedVersion?.id ?? mount?.id}
                    onChange={version => {
                      setSelectedVersions(previous => ({ ...previous, [skill.id]: version }));
                      if (mount === undefined) return;
                      onChange({
                        ...spec,
                        skills: skillMounts.map(item =>
                          item === mount ? { ...item.value, id: version.id, name: version.name } : item.value,
                        ),
                      });
                    }}
                  />
                )
              }
              onToggle={() => {
                const adding = mount === undefined;
                onChange({
                  ...spec,
                  skills: adding
                    ? [
                        ...(spec.skills ?? []),
                        { id: selectedVersion?.id ?? skill.id, name: selectedVersion?.name ?? skill.name },
                      ]
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
