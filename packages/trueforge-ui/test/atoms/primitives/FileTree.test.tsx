// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FileTree } from '@/atoms/primitives/FileTree.js';

type Entry = { id: string; path: string };

const entries: Entry[] = [
  { id: '1', path: 'readme.md' },
  { id: '2', path: 'references/imports.md' },
  { id: '3', path: 'references/notes.md' },
  { id: '4', path: 'references/deep/leaf.md' },
];

const getPath = (entry: Entry) => entry.path;
const getKey = (entry: Entry) => entry.id;

function renderTree(props: { defaultExpanded?: boolean } = {}) {
  return render(
    <FileTree
      items={entries}
      getPath={getPath}
      getKey={getKey}
      renderItem={({ name }) => <span>{name}</span>}
      {...props}
    />,
  );
}

describe('FileTree', () => {
  it('renders root files plainly and groups shared folders under one chevron row', () => {
    renderTree();

    expect(screen.getByText('readme.md')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /references/ })).toHaveLength(1);
    expect(screen.getByText('imports.md')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deep/ })).toBeInTheDocument();
    expect(screen.getByText('leaf.md')).toBeInTheDocument();
  });

  it('collapses and expands a folder from its row', () => {
    renderTree();
    const folder = screen.getByRole('button', { name: /references/ });
    expect(folder).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(folder);
    expect(folder).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('imports.md')).not.toBeInTheDocument();
    expect(screen.queryByText('leaf.md')).not.toBeInTheDocument();
    expect(screen.getByText('readme.md')).toBeInTheDocument();

    fireEvent.click(folder);
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('imports.md')).toBeInTheDocument();
  });

  it('starts collapsed when defaultExpanded is false', () => {
    renderTree({ defaultExpanded: false });
    const folder = screen.getByRole('button', { name: /references/ });
    expect(folder).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('imports.md')).not.toBeInTheDocument();

    fireEvent.click(folder);
    expect(screen.getByText('imports.md')).toBeInTheDocument();
  });
});
