'use client';

import { useAuiState } from '@assistant-ui/react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import type { ComposerAssistantAgentsPickerSelection } from '../atoms/ComposerAssistantAgentsPicker.js';
import { libraryAgentId, useOptionalShellMode, type ShellMode } from '../server/ShellModeContext.js';
import type { AgentLibraryEntry } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { isNewChatView } from '../utils/isNewChatView.js';

function selectionFromShell(mode: ShellMode): ComposerAssistantAgentsPickerSelection {
  // Try Agent is the only immutable binding with a display name for this picker.
  if (mode.status === 'active' && !mode.isMutable) {
    const agentName = mode.agentName ?? mode.agentId;
    if (agentName != null && agentName.length > 0) {
      return {
        kind: 'agent',
        agentId: mode.agentId ?? agentName,
        agentName,
      };
    }
  }
  return { kind: 'assistant' };
}

/**
 * Wires the composer Assistant / Agents picker to shell mode.
 * `selectLibraryAgent` / `openDraft` already drive `try_agent_name` via ShellRouteSync.
 */
export function ComposerAssistantAgentsPickerContainer() {
  const ComposerAssistantAgentsPicker = useSlot('ComposerAssistantAgentsPicker');
  const shell = useOptionalShellMode();
  const track = useTrackAnalytics();
  // Disable only while a turn streams so picking mid-flight cannot remount the runtime.
  const isRunning = useAuiState(s => s.thread.isRunning);
  // History sessions and in-progress threads keep the docked composer without mode switching.
  const showOnNewChatOnly = useAuiState(isNewChatView);

  if (shell == null || !shell.isComposerEnabled || !shell.isLibraryEnabled) {
    return null;
  }

  // New Agent / Edit keep their own chrome; this picker is for New Chat vs Try Agent.
  if (shell.mode.status === 'active' && shell.mode.isMutable && shell.mode.isCreateAgent) {
    return null;
  }

  if (!showOnNewChatOnly) {
    return null;
  }

  const selection = selectionFromShell(shell.mode);
  const disabled = isRunning;

  const handleSelectAssistant = () => {
    track(AnalyticsEvents.Composer.ASSISTANT_SELECTED);
    shell.openDraft();
  };

  const handleSelectAgent = (agent: AgentLibraryEntry) => {
    const agentId = libraryAgentId(agent);
    track(AnalyticsEvents.Composer.AGENT_SELECTED, {
      agent_id: agentId,
      agent_name: agent.name,
    });
    // Same path as the library Try button: shell sets history filter, route sync writes ?try_agent_name=.
    shell.selectLibraryAgent({
      isMutable: false,
      agentId,
      agentName: agent.name,
    });
  };

  return (
    <ComposerAssistantAgentsPicker
      selection={selection}
      disabled={disabled}
      onSelectAssistant={handleSelectAssistant}
      onSelectAgent={handleSelectAgent}
    />
  );
}
