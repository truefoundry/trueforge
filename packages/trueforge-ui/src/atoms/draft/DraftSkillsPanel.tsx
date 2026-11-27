'use client';

import { useEffect, useMemo, useState } from 'react';

import { isSettingsSectionEnabled } from '../../server/serverChrome.js';
import { useOptionalCatalogServer, useServerCapabilities } from '../../server/ServerContext.js';
import { useOptionalShellMode, type SettingsSection } from '../../server/ShellModeContext.js';
import type { AgentSkill } from '../../server/types.js';
import { DraftCatalogEmptyState } from './DraftCatalogEmptyState.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { CatalogRow, CatalogSearchField, RowNote, SectionHeading } from './DraftCatalogRow.js';
import type { DraftMount } from './draftMounts.js';
import { skillFamilyId, skillRepoName } from './SkillVersionSelector.js';

export type DraftSkillsPanelProps = {
  selected: DraftMount[];
  onToggleSkill: (skill: AgentSkill) => void;
  /** Closes the enclosing menu before navigating to settings. */
  onClose: () => void;
};

export function DraftSkillsPanel({ selected, onToggleSkill, onClose }: DraftSkillsPanelProps) {
  const { skills, loading, ensureLoaded } = useDraftCatalog();
  const capabilities = useServerCapabilities();
  const settingsCatalog = useOptionalCatalogServer();
  const shell = useOptionalShellMode();
  const [query, setQuery] = useState('');
  // Snapped on mount, same as the connectors panel, so toggles don't reorder rows mid-session.
  const [pinnedSkillIds] = useState(() => new Set(selected.map(m => skillFamilyId(m.id))));

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const skillsDisabled = capabilities?.skill.enabled !== true;
  const skillsDisabledReason = capabilities?.skill.reason;
  const needsSandbox = capabilities?.sandbox.enabled === false;
  const settings = capabilities?.settings;
  const canConfigureSkills =
    isSettingsSectionEnabled({ settings, section: 'skills' }) && settingsCatalog?.skillCatalog != null;
  const canConfigureSandbox =
    isSettingsSectionEnabled({ settings, section: 'sandboxProviders' }) && settingsCatalog?.sandboxCatalog != null;

  const needle = query.trim().toLowerCase();
  const filteredSkills = useMemo(() => {
    if (!needle) return skills;
    return skills.filter(
      skill =>
        skill.name.toLowerCase().includes(needle) ||
        (skillRepoName(skill)?.toLowerCase().includes(needle) ?? false) ||
        (skill.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [skills, needle]);
  const pinnedSelectedSkills = filteredSkills.filter(s => pinnedSkillIds.has(skillFamilyId(s.id)));
  const pinnedAvailableSkills = filteredSkills.filter(s => !pinnedSkillIds.has(skillFamilyId(s.id)));

  const openSettings = (section: SettingsSection) => {
    onClose();
    shell?.setSettingsOpen(true, section);
  };

  const renderSkill = (skill: AgentSkill) => {
    const selectedMount = selected.find(mount => skillFamilyId(mount.id) === skillFamilyId(skill.id));
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
        checked={selectedMount !== undefined}
        disabled={skillsDisabled && selectedMount === undefined}
        onToggle={() => onToggleSkill(skill)}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CatalogSearchField value={query} onChange={setQuery} placeholder="Search skills..." />
      {skillsDisabled && skillsDisabledReason ? <RowNote>{skillsDisabledReason}</RowNote> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {pinnedSelectedSkills.length > 0 ? (
          <>
            <SectionHeading label="Selected" count={pinnedSelectedSkills.length} />
            {pinnedSelectedSkills.map(renderSkill)}
          </>
        ) : null}
        {pinnedAvailableSkills.length > 0 ? (
          <>
            <SectionHeading label="Available" count={pinnedAvailableSkills.length} />
            {pinnedAvailableSkills.map(renderSkill)}
          </>
        ) : null}
        {filteredSkills.length === 0 ? (
          <DraftCatalogEmptyState
            loading={loading}
            emptyLabel="No skills"
            settingsTarget={needsSandbox ? 'a Sandbox' : 'Skills'}
            onOpenSettings={
              skills.length === 0 && shell && (needsSandbox ? canConfigureSandbox : canConfigureSkills)
                ? () => openSettings(needsSandbox ? 'sandbox' : 'skills')
                : undefined
            }
          />
        ) : null}
      </div>
    </div>
  );
}
