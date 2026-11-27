'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useMemo, useState } from 'react';

import { readSandboxEnvironmentName, sandboxWithEnvironmentName } from '../../server/draftSpecPreferences.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import { environmentUnavailableReason } from '../environments/environmentDisplay.js';
import { useSandboxEnvironments } from '../environments/useSandboxEnvironments.js';
import { DraftCatalogEmptyState } from './DraftCatalogEmptyState.js';
import { CatalogRow, CatalogSearchField, RowNote } from './DraftCatalogRow.js';

const ENVIRONMENT_LOCKED_HINT = "Can't change the environment after a chat has started";

export type DraftEnvironmentPanelProps = {
  /** Closes the enclosing menu before navigating to environment settings. */
  onClose: () => void;
};

export function DraftEnvironmentPanel({ onClose }: DraftEnvironmentPanelProps) {
  const shell = useOptionalShellMode();
  const { agentSpec, draftSessionId } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  // Turns reuse the session sandbox; changing environment after create would only update the spec.
  const environmentLocked = draftSessionId != null;
  const [query, setQuery] = useState('');
  // Loads on mount, so each open of this panel reads the current environment list.
  const { environments, defaultEnvironment, loading } = useSandboxEnvironments();

  // Naming none means the tenant default applies, so show it rather than nothing selected.
  const currentEnvName = readSandboxEnvironmentName(agentSpec?.config?.sandbox) ?? defaultEnvironment?.name;

  const filteredEnvironments = useMemo(() => {
    // Everything is listed; what cannot be picked is greyed out and says why on hover.
    const all: Array<{ value: string; title: string; description: string | undefined; unavailable?: string }> =
      environments.map(e => {
        const reason = environmentUnavailableReason(e);
        return {
          value: e.name,
          title: e.name,
          description: e.manifest.description,
          ...(reason === undefined ? {} : { unavailable: reason }),
        };
      });
    // Keep the session's recorded environment visible (and selected) if it left the catalog.
    if (currentEnvName !== undefined && !all.some(item => item.value === currentEnvName)) {
      all.unshift({
        value: currentEnvName,
        title: currentEnvName,
        description: undefined,
        unavailable: 'No longer available.',
      });
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      item => item.title.toLowerCase().includes(needle) || (item.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [environments, query, currentEnvName]);

  const selectEnvironment = (value: string) => {
    if (environmentLocked) return;
    updateAgentSpec?.({
      config: {
        ...agentSpec?.config,
        sandbox: {
          ...sandboxWithEnvironmentName(agentSpec?.config?.sandbox, value),
          enabled: true,
        },
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CatalogSearchField value={query} onChange={setQuery} placeholder="Search environment..." />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {environmentLocked ? <RowNote>{ENVIRONMENT_LOCKED_HINT}</RowNote> : null}
        {filteredEnvironments.map(env => {
          const isSelected = currentEnvName === env.value;
          const reason = environmentLocked ? ENVIRONMENT_LOCKED_HINT : env.unavailable;
          return (
            <CatalogRow
              key={env.value}
              title={env.title}
              description={env.description}
              fallbackIcon="monitor"
              selectionControl="radio"
              checked={isSelected}
              disabled={reason !== undefined}
              {...(reason === undefined ? {} : { disabledReason: reason })}
              onToggle={() => selectEnvironment(env.value)}
            />
          );
        })}
        {filteredEnvironments.length === 0 ? (
          <DraftCatalogEmptyState
            loading={loading}
            emptyLabel="No environments"
            settingsTarget="Environments"
            onOpenSettings={
              shell
                ? () => {
                    onClose();
                    shell.setEnvironmentsOpen(true);
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    </div>
  );
}
