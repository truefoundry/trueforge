'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useServerCapabilities } from '../../server/ServerContext.js';
import type { AgentSkill, ConnectorState } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import type { DraftComposerAction } from './DraftComposerActionsMenu.js';
import { DraftConnectorsPanel } from './DraftConnectorsPanel.js';
import { DraftEnvironmentPanel } from './DraftEnvironmentPanel.js';
import { draftMountsFromSpec, type DraftMount } from './draftMounts.js';
import { DraftSelectionChips } from './DraftSelectionChips.js';
import { DraftSkillsPanel } from './DraftSkillsPanel.js';
import { skillFamilyId } from './SkillVersionSelector.js';

const SPEC_FLUSH_MS = 300;

export type DraftCompositeSelectorProps = {
  disabled?: boolean;
  onAttach?: () => void;
};

/**
 * Plus menu for the draft composer. Connector, skill, and environment edits go to a
 * local copy while the menu is open and flush to the agent spec on a debounce or on close.
 */
export function DraftCompositeSelector({ disabled, onAttach }: DraftCompositeSelectorProps) {
  const DraftComposerActionsMenu = useSlot('DraftComposerActionsMenu');
  const capabilities = useServerCapabilities();
  const track = useTrackAnalytics();
  const { agentSpec } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const [open, setOpen] = useState(false);
  const [localMcp, setLocalMcp] = useState<DraftMount[]>([]);
  const [localSkills, setLocalSkills] = useState<DraftMount[]>([]);
  const dirtyRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const localMcpRef = useRef(localMcp);
  const localSkillsRef = useRef(localSkills);
  localMcpRef.current = localMcp;
  localSkillsRef.current = localSkills;

  const environmentsCapabilityEnabled = capabilities?.sandbox?.environments?.enabled === true;
  const hasValidModel = Boolean(agentSpec?.model?.name.trim());
  const specMcp = useMemo(() => draftMountsFromSpec(agentSpec?.mcpServers), [agentSpec?.mcpServers]);
  const specSkills = useMemo(() => draftMountsFromSpec(agentSpec?.skills), [agentSpec?.skills]);
  const selectedMcp = open ? localMcp : specMcp;
  const selectedSkills = open ? localSkills : specSkills;

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushSpec = useCallback(() => {
    clearFlushTimer();
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    updateAgentSpec?.({
      mcpServers: localMcpRef.current,
      skills: localSkillsRef.current,
    });
  }, [clearFlushTimer, updateAgentSpec]);

  const scheduleFlush = useCallback(() => {
    clearFlushTimer();
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushSpec();
    }, SPEC_FLUSH_MS);
  }, [clearFlushTimer, flushSpec]);

  const closeMenu = useCallback(() => {
    flushSpec();
    setOpen(false);
  }, [flushSpec]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      closeMenu();
      return;
    }
    setLocalMcp(specMcp);
    setLocalSkills(specSkills);
    dirtyRef.current = false;
    clearFlushTimer();
    setOpen(true);
    track(AnalyticsEvents.Composer.ADD_MENU_OPENED);
  };

  useEffect(() => {
    if (open && !hasValidModel) closeMenu();
  }, [hasValidModel, open, closeMenu]);

  useEffect(() => () => clearFlushTimer(), [clearFlushTimer]);

  const toggleConnector = (connector: ConnectorState) => {
    setLocalMcp(prev =>
      prev.some(m => m.id === connector.id)
        ? prev.filter(m => m.id !== connector.id)
        : [...prev, { id: connector.id, name: connector.name }],
    );
    dirtyRef.current = true;
    scheduleFlush();
  };

  const toggleSkill = (skill: AgentSkill) => {
    const family = skillFamilyId(skill.id);
    const adding = !localSkillsRef.current.some(item => skillFamilyId(item.id) === family);
    setLocalSkills(previous =>
      previous.some(item => skillFamilyId(item.id) === family)
        ? previous.filter(item => skillFamilyId(item.id) !== family)
        : [...previous, { id: skill.id, name: skill.name }],
    );
    if (adding && capabilities?.sandbox.enabled === true) {
      updateAgentSpec?.({
        config: {
          ...agentSpec?.config,
          sandbox: { ...agentSpec?.config?.sandbox, enabled: true },
        },
      });
    }
    dirtyRef.current = true;
    scheduleFlush();
  };

  const trackMenuItem = (item: string) => {
    track(AnalyticsEvents.Composer.ADD_MENU_ITEM_SELECTED, { item });
  };

  const menuActions: DraftComposerAction[] = [
    ...(onAttach === undefined
      ? []
      : [
          {
            id: 'attach',
            label: 'Add Files or photos',
            icon: 'paperclip',
            onSelect: () => {
              trackMenuItem('attach');
              onAttach();
            },
          },
        ]),
    ...(hasValidModel
      ? [
          {
            id: 'connectors',
            label: 'Connectors',
            icon: 'plug',
            onSelect: () => trackMenuItem('connectors'),
            submenu: (
              <DraftConnectorsPanel selected={selectedMcp} onToggleConnector={toggleConnector} onClose={closeMenu} />
            ),
          },
          {
            id: 'skills',
            label: 'Skills',
            icon: 'scroll-text',
            onSelect: () => trackMenuItem('skills'),
            submenu: <DraftSkillsPanel selected={selectedSkills} onToggleSkill={toggleSkill} onClose={closeMenu} />,
          },
          ...(environmentsCapabilityEnabled
            ? [
                {
                  id: 'environments',
                  label: 'Environment',
                  icon: 'monitor',
                  onSelect: () => trackMenuItem('environments'),
                  submenu: <DraftEnvironmentPanel onClose={closeMenu} />,
                },
              ]
            : []),
        ]
      : []),
  ];

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <DraftComposerActionsMenu actions={menuActions} disabled={disabled} open={open} onOpenChange={handleOpenChange} />
      <DraftSelectionChips connectors={selectedMcp} skills={selectedSkills} />
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftCompositeSelector: typeof DraftCompositeSelector;
  }
}
