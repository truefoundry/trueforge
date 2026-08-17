// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import SkillSettings from '@/containers/SettingsBuilder/SkillSettings.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { CreateSkillRequest, DefinedSkill, SkillCatalogEntry } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const catalogEntry: SkillCatalogEntry = {
  id: 'cat-code-review',
  name: 'Code Review',
  description: 'Review a diff for correctness, risk and style.',
  repoURL: 'https://github.com/truefoundry/skills',
  path: 'skills/code-review',
  ref: 'main',
};

/** In-memory host: catalog is fixed, defined skills live in a mutable list. */
function createFakeHost(initial: DefinedSkill[] = []) {
  let defined = [...initial];
  const created: CreateSkillRequest[] = [];

  const skillCatalog = {
    getSkillCatalog: async () => [catalogEntry],
    listSkills: async () => defined,
    createSkill: async (req: CreateSkillRequest) => {
      created.push(req);
      const skill: DefinedSkill =
        'catalogId' in req
          ? {
              id: `db-${req.catalogId}`,
              name: req.name,
              description: req.description,
              catalogId: req.catalogId,
            }
          : {
              id: `db-${req.name}`,
              name: req.name,
              description: req.description,
            };
      defined = [...defined, skill];
      return skill;
    },
    deleteSkill: async ({ id }: { id: string }) => {
      defined = defined.filter(skill => skill.id !== id);
    },
  };

  const server = createMockAgentUIServer({
    catalog: createMockCatalog({ skillCatalog }),
  });

  return {
    created,
    getDefined: () => defined,
    wrapper: ({ children }: { children: ReactNode }) => <ServerProvider server={server}>{children}</ServerProvider>,
  };
}

describe('SkillSettings', () => {
  it('selects a catalog skill and moves it out of Available', async () => {
    const host = createFakeHost();
    const { wrapper: Wrapper } = host;

    render(
      <Wrapper>
        <SkillSettings />
      </Wrapper>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Enable Code Review' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove Code Review' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Enable Code Review' })).toBeNull();
    expect(host.created).toEqual([
      {
        catalogId: catalogEntry.id,
        name: catalogEntry.name,
        description: catalogEntry.description,
        repoURL: catalogEntry.repoURL,
        path: catalogEntry.path,
        ref: catalogEntry.ref,
      },
    ]);
  });

  it('returns a removed registry skill to Available', async () => {
    const { wrapper: Wrapper } = createFakeHost([
      {
        id: 'db-cat-code-review',
        name: catalogEntry.name,
        description: catalogEntry.description,
        catalogId: catalogEntry.id,
      },
    ]);

    render(
      <Wrapper>
        <SkillSettings />
      </Wrapper>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Code Review' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enable Code Review' })).toBeTruthy();
    });
  });

  it('removes an imported github skill entirely', async () => {
    const host = createFakeHost([
      {
        id: 'db-house-style',
        name: 'House Style',
        description: 'Writing rules and tone-of-voice for external copy.',
      },
    ]);
    const { wrapper: Wrapper } = host;

    render(
      <Wrapper>
        <SkillSettings />
      </Wrapper>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove House Style' }));

    await waitFor(() => {
      expect(screen.queryByText('House Style')).toBeNull();
    });
    expect(host.getDefined()).toEqual([]);
  });

  it('imports a github skill without a type discriminant', async () => {
    const host = createFakeHost();
    const { wrapper: Wrapper } = host;

    render(
      <Wrapper>
        <SkillSettings />
      </Wrapper>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Import from GitHub/ }));

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'House Style' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Writing rules' },
    });
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/org/repo' },
    });
    fireEvent.change(screen.getByLabelText('Folder containing the SKILL.md'), {
      target: { value: 'skills/house-style' },
    });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(host.created).toEqual([
        {
          name: 'House Style',
          description: 'Writing rules',
          repoURL: 'https://github.com/org/repo',
          path: 'skills/house-style',
          ref: 'main',
        },
      ]);
    });
  });
});
