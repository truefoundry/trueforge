'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalArtifactServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isArtifactsChromeEnabled } from '../server/serverChrome.js';
import {
  auiButtonClass,
  shellRailSelectedClassName,
  sidebarButtonRadiusClassName,
  sidebarRailButtonClassName,
} from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { RailTooltip } from './primitives/Tooltip.js';

export type ArtifactsButtonProps = {
  className?: string;
  compact?: boolean;
};

export function ArtifactsButton({ className, compact = false }: ArtifactsButtonProps) {
  const shell = useOptionalShellMode();
  const artifactServer = useOptionalArtifactServer();
  const track = useTrackAnalytics();

  const enabled = isArtifactsChromeEnabled({ artifacts: artifactServer }) && shell != null;
  const open = shell?.artifactsOpen === true;

  if (!enabled) return null;

  const button = (
    <button
      type="button"
      aria-label={compact ? 'Artifacts' : undefined}
      aria-current={open ? 'page' : undefined}
      className={auiButtonClass({
        variant: 'ghost',
        className: cn(
          'font-normal shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
          compact
            ? cn(sidebarRailButtonClassName, 'text-inherit')
            : cn(sidebarButtonRadiusClassName, 'h-8 w-full !justify-start px-2.5 text-sm text-sidebar-text'),
          open && shellRailSelectedClassName,
        ),
      })}
      onClick={() => {
        if (!open) track(AnalyticsEvents.Artifact.PAGE_OPENED);
        shell.setArtifactsOpen(!open);
      }}
    >
      <Icon name="gallery-horizontal-end" size={compact ? 16 : undefined} />
      {compact ? null : (
        <>
          <span className="truncate">Artifacts</span>
          <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
        </>
      )}
    </button>
  );

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      {compact ? <RailTooltip content="Artifacts">{button}</RailTooltip> : button}
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ArtifactsButton: typeof ArtifactsButton;
  }
}
