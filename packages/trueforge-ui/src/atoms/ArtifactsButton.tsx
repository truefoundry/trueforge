'use client';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { Icon } from '../icons/Icon.js';
import { useOptionalArtifactServer } from '../server/ServerContext.js';
import { useOptionalShellMode } from '../server/ShellModeContext.js';
import { isArtifactsChromeEnabled } from '../server/serverChrome.js';
import { auiButtonClass, sidebarButtonRadiusClassName, sidebarRailButtonClassName } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export type ArtifactsButtonProps = {
  className?: string;
  compact?: boolean;
};

export function ArtifactsButton({ className, compact = false }: ArtifactsButtonProps) {
  const shell = useOptionalShellMode();
  const artifactServer = useOptionalArtifactServer();
  const track = useTrackAnalytics();
  const enabled = isArtifactsChromeEnabled({ artifacts: artifactServer }) && shell != null;
  const open = shell?.artifactsOpen === true || shell?.artifactView != null;

  if (!enabled) return null;

  return (
    <div className={cn('relative min-w-0', compact ? 'flex justify-center' : 'w-full', className)}>
      <button
        type="button"
        aria-label={compact ? 'Artifacts' : undefined}
        title={compact ? 'Artifacts' : undefined}
        aria-current={open ? 'page' : undefined}
        className={auiButtonClass({
          variant: 'ghost',
          className: cn(
            sidebarButtonRadiusClassName,
            'font-normal text-sidebar-text shadow-none hover:bg-secondary-button-hover hover:text-ghost-button-text',
            compact ? sidebarRailButtonClassName : 'h-8 w-full !justify-start px-2.5 text-sm',
            open &&
              'bg-primary-button-bg font-medium text-primary-button-text hover:bg-primary-button-hover hover:text-primary-button-text',
          ),
        })}
        onClick={() => {
          if (!shell.artifactsOpen) track(AnalyticsEvents.Artifact.PAGE_OPENED);
          shell.setArtifactsOpen(!shell.artifactsOpen);
        }}
      >
        <Icon name="file-code" size={compact ? 14 : undefined} />
        {compact ? (
          <span className="text-center">Artifacts</span>
        ) : (
          <>
            <span className="truncate">Artifacts</span>
            <Icon name="chevron-right" className="ml-auto size-3.5 shrink-0 opacity-60" />
          </>
        )}
      </button>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    ArtifactsButton: typeof ArtifactsButton;
  }
}
