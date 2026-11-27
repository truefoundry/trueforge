'use client';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { withSessionProps } from '../../analytics/sessionProps.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../../server/ShellModeContext.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import type { ComposerLeftSectionProps, ComposerRightSectionProps } from '../ComposerSections.js';
import { useCompactLayout } from '../lib/CompactLayoutContext.js';
import { useIsMobile } from '../lib/useIsMobile.js';

export function DraftComposerLeftSection({ disabled, onAttach }: ComposerLeftSectionProps) {
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  const DraftCompositeSelector = useSlot('DraftCompositeSelector');
  const DraftAgentConfigTrigger = useSlot('DraftAgentConfigTrigger');
  const DraftComposerActionsMenu = useSlot('DraftComposerActionsMenu');
  const compact = useCompactLayout();
  const isMobile = useIsMobile();
  const isBuilder = shell != null && shellIsCreateAgent(shell.mode);
  // Agent config lives in the plus menu only when the side panel can't be shown;
  // with attach alone the menu collapses to a direct attach button.
  const builderActions = [
    ...(compact
      ? [
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
        ]
      : []),
    ...(onAttach === undefined
      ? []
      : [
          {
            id: 'attach',
            label: 'Add Files or photos',
            icon: 'paperclip',
            onSelect: onAttach,
          },
        ]),
  ];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {!isBuilder ? <DraftCompositeSelector disabled={disabled} onAttach={onAttach} /> : null}
      {isBuilder ? <DraftComposerActionsMenu actions={builderActions} disabled={disabled} /> : null}
      {isBuilder && !compact && isMobile ? <DraftAgentConfigTrigger disabled={disabled} /> : null}
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
