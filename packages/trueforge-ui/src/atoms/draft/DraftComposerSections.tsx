'use client';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { withSessionProps } from '../../analytics/sessionProps.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../../server/ShellModeContext.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { useArtifactPickerSheet } from '../ComposerAttachMenu.js';
import type { ComposerLeftSectionProps, ComposerRightSectionProps } from '../ComposerSections.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';

export function DraftComposerLeftSection({ disabled, onAttach, artifactAttach }: ComposerLeftSectionProps) {
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const DraftCompositeSelector = useSlot('DraftCompositeSelector');
  const DraftAgentConfigTrigger = useSlot('DraftAgentConfigTrigger');
  const DraftComposerActionsMenu = useSlot('DraftComposerActionsMenu');
  const ComposerAttachMenu = useSlot('ComposerAttachMenu');
  const artifactSheet = useArtifactPickerSheet(artifactAttach);
  const compact = useCompactLayout();
  const isMobile = useIsMobile();
  const isBuilder = shell != null && shellIsCreateAgent(shell.mode);
  const compactActions = [
    {
      id: 'agent-config',
      label: 'Agent config',
      icon: 'sliders',
      onSelect: () => {
        track(
          AnalyticsEvents.Config.OPENED,
          withSessionProps(undefined, {
            ...(shell?.mode.status === 'active'
              ? { agentId: shell.mode.agentId, agentName: shell.mode.agentName }
              : {}),
          }),
        );
        shell?.setAgentConfigOpen(true);
      },
    },
    ...(onAttach === undefined
      ? []
      : [
          {
            id: 'attach',
            label: 'Attach a file',
            icon: 'paperclip',
            onSelect: onAttach,
          },
        ]),
    ...(artifactSheet.action == null ? [] : [artifactSheet.action]),
  ];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {!isBuilder ? (
        <DraftCompositeSelector disabled={disabled} onAttach={onAttach} artifactAttach={artifactAttach} />
      ) : null}
      {isBuilder && compact ? <DraftComposerActionsMenu actions={compactActions} disabled={disabled} /> : null}
      {isBuilder && !compact && isMobile ? <DraftAgentConfigTrigger disabled={disabled} /> : null}
      {isBuilder && !compact ? (
        <ComposerAttachMenu
          disabled={disabled}
          label="Attach a file"
          onAttach={onAttach}
          artifactAttach={artifactAttach}
        />
      ) : null}
      {isBuilder ? artifactSheet.sheet : null}
    </div>
  );
}

export function DraftComposerRightSection({ disabled }: ComposerRightSectionProps) {
  const shell = useOptionalShellMode();
  const DraftModelSelector = useSlot('DraftModelSelector');
  const isBuilder = shell != null && shellIsCreateAgent(shell.mode);

  return (
    <div className="flex min-w-0 items-center gap-1">
      {!isBuilder ? <DraftModelSelector disabled={disabled} /> : null}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    DraftComposerLeftSection: typeof DraftComposerLeftSection;
    DraftComposerRightSection: typeof DraftComposerRightSection;
  }
}
