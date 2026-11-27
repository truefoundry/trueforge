// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { artifactPreviewKey } from '@/atoms/artifacts/artifactDisplay.js';
import { SessionArtifactsCard } from '@/atoms/artifacts/SessionArtifactsCard.js';
import type { Artifact } from '@/server/types.js';

const subject = { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'alice' };

function artifact(id: string, name: string): Artifact {
  return {
    id,
    name,
    createdBySubject: subject,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
}

const names = ['a.png', 'b.html', 'c.mp4', 'd.mp3', 'e.pdf', 'f.txt', 'g.png', 'h.png'];
const artifacts = names.map((name, index) => artifact(`id-${String(index)}`, name));

describe('SessionArtifactsCard', () => {
  it('shows six rows with type labels and a "Show N more" toggle', () => {
    const onShowMore = vi.fn();
    render(
      <SessionArtifactsCard artifacts={artifacts} selectedKey={undefined} onOpen={vi.fn()} onShowMore={onShowMore} />,
    );

    expect(screen.getByRole('heading', { name: 'Artifacts' })).toBeInTheDocument();
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('f.txt')).toBeInTheDocument();
    expect(screen.queryByText('g.png')).not.toBeInTheDocument();
    expect(screen.getAllByText('Image')).toHaveLength(1);
    expect(screen.getByText('Html')).toBeInTheDocument();
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Pdf')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(onShowMore).toHaveBeenCalledTimes(1);
    expect(screen.getByText('g.png')).toBeInTheDocument();
    expect(screen.getByText('h.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText('g.png')).not.toBeInTheDocument();
    expect(onShowMore).toHaveBeenCalledTimes(1);
  });

  it('hides the toggle when everything fits', () => {
    render(<SessionArtifactsCard artifacts={artifacts.slice(0, 3)} selectedKey={undefined} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Show/ })).not.toBeInTheDocument();
  });

  it('opens an artifact on row click and marks the selected one', () => {
    const onOpen = vi.fn();
    const selected = artifacts[1];
    if (selected === undefined) throw new Error('missing fixture');
    render(<SessionArtifactsCard artifacts={artifacts} selectedKey={artifactPreviewKey(selected)} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: /a\.png/ }));
    expect(onOpen).toHaveBeenCalledWith(artifacts[0]);
    expect(screen.getByRole('button', { name: /b\.html/ })).toHaveClass('bg-secondary-button-hover');
  });

  it('nests artifacts that share a folder under an expandable row', () => {
    render(
      <SessionArtifactsCard
        artifacts={[artifact('1', 'assets/logo.png'), artifact('2', 'assets/hero.png'), artifact('3', 'demo.mp4')]}
        selectedKey={undefined}
        onOpen={vi.fn()}
      />,
    );

    const folder = screen.getByRole('button', { name: /assets/ });
    expect(screen.getByText('logo.png')).toBeInTheDocument();
    fireEvent.click(folder);
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
    expect(screen.getByText('demo.mp4')).toBeInTheDocument();
  });
});
