// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AppearanceSettings from '@/containers/SettingsBuilder/AppearanceSettings.js';
import { ThemeProvider } from '@/theme/ThemeProvider.js';
import { DEFAULT_TYPEFACE_ID, TYPEFACE_OPTIONS } from '@/theme/typefaces.js';

describe('AppearanceSettings', () => {
  afterEach(() => {
    localStorage.removeItem('aui-typeface');
    for (const option of TYPEFACE_OPTIONS) {
      document.getElementById(`trueforge-ui-typeface-${option.id}`)?.remove();
    }
  });

  it('opens an alphabetical typeface dropdown, marks the default, and supports reset', () => {
    const { container } = render(
      <ThemeProvider theme={{ preset: 'trueforge', mode: 'light' }}>
        <AppearanceSettings />
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Visual style' })).toBeInTheDocument();
    expect(DEFAULT_TYPEFACE_ID).toBe('geist');

    const trigger = screen.getByRole('button', { name: 'Typeface' });
    expect(trigger).toHaveTextContent('Geist (Default)');
    expect(screen.queryByRole('button', { name: 'Reset typeface to default' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Typeface' });
    const optionLabels = within(listbox)
      .getAllByRole('option')
      .map(option => option.getAttribute('aria-label') ?? '');
    expect(optionLabels).toEqual(
      [...optionLabels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    );
    expect(within(listbox).getByRole('option', { name: 'Geist (Default)' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(listbox).getByRole('option', { name: 'Inter' }));
    expect(trigger).toHaveTextContent('Inter');
    expect(localStorage.getItem('aui-typeface')).toBe('inter');
    expect(container.querySelector('.aui-theme-root')).toHaveAttribute('data-typeface', 'inter');

    const reset = screen.getByRole('button', { name: 'Reset typeface to default' });
    fireEvent.click(reset);
    expect(localStorage.getItem('aui-typeface')).toBeNull();
    expect(container.querySelector('.aui-theme-root')).not.toHaveAttribute('data-typeface');
    expect(trigger).toHaveTextContent('Geist (Default)');
    expect(screen.queryByRole('button', { name: 'Reset typeface to default' })).not.toBeInTheDocument();
  });
});
