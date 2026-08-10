// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WelcomeScreenProps } from '@/atoms/WelcomeScreen.js';
import { Thread } from '@/containers/Thread.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryCancel: () => vi.fn(),
  useTrueFoundryToolResponses: () => ({ pending: [] }),
  useTrueFoundryAgentSpec: () => ({ agentSpec: { model: { name: 'test/model' } } }),
}));

function WelcomeOverride({ heading }: WelcomeScreenProps) {
  return <div data-testid="welcome-slot">{heading ?? 'Custom welcome'}</div>;
}

describe('Thread', () => {
  it('assembles the thread view and composer while honoring thread slots', () => {
    render(
      <SlotsProvider overrides={{ WelcomeScreen: WelcomeOverride }}>
        <RuntimeHarness messages={[]}>
          <Thread />
        </RuntimeHarness>
      </SlotsProvider>,
    );

    expect(screen.getByTestId('welcome-slot')).toHaveTextContent('Custom welcome');
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="aui_thread-viewport"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="aui_composer-shell"]')).toBeInTheDocument();
  });
});
