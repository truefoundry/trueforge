'use client';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useSessionArtifactsAvailable } from '../../containers/SessionArtifactsContainer.js';
import { useOptionalSessionArtifactsPanel } from '../../containers/SessionArtifactsPanelContext.js';
import { Icon } from '../../icons/Icon.js';
import { Button } from '../primitives/Button.js';

/** Header control that shows or hides the session artifacts card; appears once the session has artifacts. */
export function SessionArtifactsToggleButton() {
  const available = useSessionArtifactsAvailable();
  const panel = useOptionalSessionArtifactsPanel();
  const track = useTrackAnalytics();

  if (!available || panel == null) return null;

  const { open, setOpen } = panel;

  return (
    <Button.Ghost
      type="button"
      // The card column only exists at lg and up, so the control is hidden below it.
      className="hidden lg:inline-flex"
      aria-pressed={open}
      title={open ? 'Hide artifacts' : 'Show artifacts'}
      onClick={() => {
        track(AnalyticsEvents.Artifact.SESSION_CARD_TOGGLED, { open: !open });
        setOpen(!open);
      }}
    >
      <Icon name="gallery-horizontal-end" />
      Artifacts
    </Button.Ghost>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    SessionArtifactsToggleButton: typeof SessionArtifactsToggleButton;
  }
}
