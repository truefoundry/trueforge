// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import ImportGithubSkillForm from '@/containers/SettingsBuilder/ImportGithubSkillForm.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
});

describe('ImportGithubSkillForm', () => {
  it('submits the complete create skill request', async () => {
    const onImport = vi.fn(async () => undefined);

    render(<ImportGithubSkillForm open onOpenChange={() => undefined} onImport={onImport} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: ' release-notes ' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: ' Generate release notes ' },
    });
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: ' https://github.com/org/repo ' },
    });
    fireEvent.change(screen.getByLabelText('Folder containing the SKILL.md'), {
      target: { value: ' skills/release-notes ' },
    });
    fireEvent.change(screen.getByLabelText('Branch'), {
      target: { value: ' main ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith({
        name: 'release-notes',
        description: 'Generate release notes',
        repoURL: 'https://github.com/org/repo',
        path: 'skills/release-notes',
        ref: 'main',
      });
    });
  });

  it('places resource, repository, path, and ref errors next to their fields', () => {
    const onImport = vi.fn(async () => undefined);

    render(
      <ImportGithubSkillForm
        open
        onOpenChange={() => undefined}
        onImport={onImport}
        existingNames={['release-notes']}
      />,
    );

    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'release-notes' } });
    fireEvent.blur(name);
    expect(screen.getByText('Skill name “release-notes” already exists.')).toBeInTheDocument();

    const repository = screen.getByLabelText('Repository URL');
    fireEvent.change(repository, { target: { value: 'https://example.com/org/repo' } });
    fireEvent.blur(repository);
    expect(screen.getByText('Enter an HTTPS GitHub or GitLab repository URL.')).toBeInTheDocument();

    const path = screen.getByLabelText('Folder containing the SKILL.md');
    fireEvent.change(path, { target: { value: '../private' } });
    fireEvent.blur(path);
    expect(screen.getByText('Skill folder must not contain “.” or “..” path segments.')).toBeInTheDocument();

    const branch = screen.getByLabelText('Branch');
    fireEvent.change(branch, { target: { value: '../main' } });
    fireEvent.blur(branch);
    expect(
      screen.getByText('Branch, tag, or commit must not contain “..” segments or only slashes.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
