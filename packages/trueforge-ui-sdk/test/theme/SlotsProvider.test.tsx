// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { WelcomeScreen } from '@/atoms/WelcomeScreen.js';
import { SlotsProvider, useSlot, useThemeMode } from '@/theme/SlotsProvider.js';

function WelcomeConsumer() {
  const SlotWelcome = useSlot('WelcomeScreen');
  return <SlotWelcome heading="hello" />;
}

function ThemeModeConsumer() {
  return <output>{useThemeMode()}</output>;
}

function CustomWelcome(_props: ComponentProps<typeof WelcomeScreen>) {
  return <p data-testid="custom-welcome">custom</p>;
}

function CustomAccordion({ children }: { children?: ReactNode }) {
  return <section data-testid="custom-accordion">{children}</section>;
}

describe('SlotsProvider', () => {
  it('resolves the default WelcomeScreen when no override is provided', () => {
    render(<WelcomeConsumer />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('resolves the default atom even without a wrapping SlotsProvider', () => {
    render(<WelcomeConsumer />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('resolves an overridden atom when wrapped in SlotsProvider', () => {
    render(
      <SlotsProvider overrides={{ WelcomeScreen }}>
        <WelcomeConsumer />
      </SlotsProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('provides the consumer-controlled theme mode', () => {
    render(
      <SlotsProvider theme={{ mode: 'dark' }}>
        <ThemeModeConsumer />
      </SlotsProvider>,
    );

    expect(screen.getByText('dark')).toBeInTheDocument();
  });

  it('replaces the resolved atom entirely with the override, not merging it', () => {
    render(
      <SlotsProvider overrides={{ WelcomeScreen: CustomWelcome }}>
        <WelcomeConsumer />
      </SlotsProvider>,
    );
    expect(screen.getByTestId('custom-welcome')).toBeInTheDocument();
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
  });

  it('nested SlotsProviders only override the slots they specify, inheriting the rest', () => {
    function AccordionConsumer() {
      const Accordion = useSlot('Accordion');
      return <Accordion>nested-ok</Accordion>;
    }

    render(
      <SlotsProvider overrides={{ WelcomeScreen: CustomWelcome }} theme={{ mode: 'dark' }}>
        <SlotsProvider overrides={{ Accordion: CustomAccordion }}>
          <WelcomeConsumer />
          <AccordionConsumer />
          <ThemeModeConsumer />
        </SlotsProvider>
      </SlotsProvider>,
    );

    expect(screen.getByTestId('custom-welcome')).toBeInTheDocument();
    expect(screen.getByTestId('custom-accordion')).toHaveTextContent('nested-ok');
    expect(screen.getByText('nested-ok')).toBeInTheDocument();
    expect(screen.getByText('dark')).toBeInTheDocument();
  });
});
