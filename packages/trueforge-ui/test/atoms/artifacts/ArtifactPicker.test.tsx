// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ArtifactPicker } from '@/atoms/artifacts/ArtifactPicker.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { Artifact, ArtifactServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockArtifactServer, createMockCatalog } from '../../server/mockServer.js';

function artifact(id: string, name: string): Artifact {
  return {
    id,
    name,
    latestVersion: 1,
    entryPoint: `${id}.md`,
    createdBySubject: { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'alice' },
    createdBySessionId: 'session-1',
    createdByAgentId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
}

const plan = artifact('a1', 'Space channel plan');
const report = artifact('a2', 'Schedules report');

function renderPicker({
  artifactServer,
  selected = [],
  onChange = vi.fn(),
}: {
  artifactServer: ArtifactServer;
  selected?: Artifact[];
  onChange?: (next: Artifact[]) => void;
}) {
  const server = createMockAgentUIServer({ catalog: createMockCatalog(), artifacts: artifactServer });
  return render(
    <ServerProvider server={server}>
      <ArtifactPicker selected={selected} onChange={onChange} onDone={() => {}} />
    </ServerProvider>,
  );
}

describe('ArtifactPicker', () => {
  it('lists own artifacts under "Created by me" and toggles selection', async () => {
    const onChange = vi.fn();
    renderPicker({
      artifactServer: createMockArtifactServer({ listArtifacts: vi.fn(async () => ({ data: [plan, report] })) }),
      selected: [report],
      onChange,
    });

    expect(await screen.findByText('Space channel plan')).toBeInTheDocument();
    expect(screen.getByText('Created by me')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Schedules report/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('option', { name: /Space channel plan/ }));
    expect(onChange).toHaveBeenLastCalledWith([report, plan]);
    fireEvent.click(screen.getByRole('option', { name: /Schedules report/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('sends the debounced search text as name', async () => {
    const listArtifacts = vi.fn(async () => ({ data: [plan] }));
    renderPicker({ artifactServer: createMockArtifactServer({ listArtifacts }) });
    await screen.findByText('Space channel plan');
    expect(listArtifacts).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
    fireEvent.change(screen.getByPlaceholderText('Search artifacts'), { target: { value: ' plan ' } });
    await waitFor(() => expect(listArtifacts).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'plan' })));
  });
});
