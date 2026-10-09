// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSkillsHeaderActionSlot } from '@/atoms/draft/AgentSkillsHeaderActionSlot.js';
import type { CatalogServer } from '@/server/types.js';
import { createMockCatalog } from '../../server/mockServer.js';

const setSettingsOpen = vi.fn();

vi.mock('@/server/ShellModeContext.js', () => ({
  useOptionalShellMode: () => ({ setSettingsOpen }),
}));

const useServerCapabilities = vi.fn();
const useOptionalCatalogServer = vi.fn();
const useServerCapabilitiesSettled = vi.fn();
const useOptionalResolvedRoutes = vi.fn();

vi.mock('@/server/ServerContext.js', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/ServerContext.js')>();
  return {
    ...actual,
    useServerCapabilities: () => useServerCapabilities(),
    useOptionalCatalogServer: () => useOptionalCatalogServer(),
    useServerCapabilitiesSettled: () => useServerCapabilitiesSettled(),
  };
});

vi.mock('@/routing/ResolvedRoutesContext.js', () => ({
  useOptionalResolvedRoutes: () => useOptionalResolvedRoutes(),
}));

async function unavailable(): Promise<never> {
  throw new Error('Unexpected settings catalog call');
}

const settingsCatalog = createMockCatalog({
  skillCatalog: {
    getSkillCatalog: async () => [],
    listSkills: async () => [],
    createSkill: unavailable,
  },
});

describe('AgentSkillsHeaderActionSlot', () => {
  const assign = vi.fn();

  beforeEach(() => {
    setSettingsOpen.mockClear();
    assign.mockClear();
    useServerCapabilitiesSettled.mockReturnValue(true);
    useServerCapabilities.mockReturnValue({
      sandbox: { enabled: true },
      skill: { enabled: true },
      settings: { enabled: true },
    });
    useOptionalCatalogServer.mockReturnValue(settingsCatalog);
    useOptionalResolvedRoutes.mockReturnValue(null);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
  });

  it('renders nothing until capabilities are settled', () => {
    useServerCapabilitiesSettled.mockReturnValue(false);

    render(<AgentSkillsHeaderActionSlot platformSkillsUrl="/platform-skills" />);

    expect(screen.queryByRole('button', { name: 'Register Skills' })).not.toBeInTheDocument();
  });

  it('opens settings skills when settings chrome and skill catalog are available', () => {
    render(<AgentSkillsHeaderActionSlot platformSkillsUrl="/platform-skills" />);

    fireEvent.click(screen.getByRole('button', { name: 'Register Skills' }));
    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'skills');
    expect(assign).not.toHaveBeenCalled();
  });

  it('navigates to platform skills URL when settings are disabled', () => {
    useServerCapabilities.mockReturnValue({
      sandbox: { enabled: true },
      skill: { enabled: true },
      settings: { enabled: false },
    });

    render(<AgentSkillsHeaderActionSlot platformSkillsUrl="/platform-skills" />);

    fireEvent.click(screen.getByRole('button', { name: 'Register Skills' }));
    expect(assign).toHaveBeenCalledWith('/platform-skills');
    expect(setSettingsOpen).not.toHaveBeenCalled();
  });

  it('navigates to platform skills URL when skill catalog is absent', () => {
    useOptionalCatalogServer.mockReturnValue(createMockCatalog() satisfies CatalogServer);

    render(<AgentSkillsHeaderActionSlot platformSkillsUrl="/platform-skills" />);

    fireEvent.click(screen.getByRole('button', { name: 'Register Skills' }));
    expect(assign).toHaveBeenCalledWith('/platform-skills');
  });

  it('hides when neither settings skills nor a platform URL are available', () => {
    useServerCapabilities.mockReturnValue({
      sandbox: { enabled: true },
      skill: { enabled: true },
      settings: { enabled: false },
    });
    useOptionalCatalogServer.mockReturnValue(createMockCatalog() satisfies CatalogServer);

    render(<AgentSkillsHeaderActionSlot platformSkillsUrl="" />);

    expect(screen.queryByRole('button', { name: 'Register Skills' })).not.toBeInTheDocument();
  });
});
