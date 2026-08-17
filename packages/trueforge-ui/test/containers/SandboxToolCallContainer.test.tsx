// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SandboxToolCallCardProps } from '@/atoms/SandboxToolCallCard.js';
import { SandboxToolCallContainer } from '@/containers/SandboxToolCallContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function SandboxToolCallCardProbe({
  name,
  status,
  expanded,
  command,
  argsJson,
  resultText,
  resultJson,
  viewMode,
  hasContent,
  onViewModeChange,
}: SandboxToolCallCardProps) {
  return (
    <section
      data-testid="sandbox-probe"
      data-name={name}
      data-status={status}
      data-expanded={String(expanded)}
      data-command={command}
      data-args={argsJson}
      data-result-text={resultText}
      data-result-json={resultJson}
      data-view-mode={viewMode}
      data-has-content={String(hasContent)}
    >
      <button type="button" onClick={() => onViewModeChange?.('terminal')}>
        Show terminal
      </button>
      <button type="button" onClick={() => onViewModeChange?.('code')}>
        Show code
      </button>
    </section>
  );
}

function renderSubject(props: Omit<SandboxToolCallCardProps, 'viewMode' | 'hasContent' | 'onViewModeChange'>) {
  return render(
    <SlotsProvider overrides={{ SandboxToolCallCard: SandboxToolCallCardProbe }}>
      <SandboxToolCallContainer {...props} />
    </SlotsProvider>,
  );
}

describe('SandboxToolCallContainer', () => {
  it('starts in terminal mode, forwards card props, and reveals argument JSON in code mode', () => {
    renderSubject({
      name: 'run_command',
      status: 'success',
      expanded: true,
      onToggle: () => {},
      argsJson: '{"command":"pwd"}',
    });

    const probe = screen.getByTestId('sandbox-probe');
    expect(probe).toHaveAttribute('data-name', 'run_command');
    expect(probe).toHaveAttribute('data-status', 'success');
    expect(probe).toHaveAttribute('data-expanded', 'true');
    expect(probe).toHaveAttribute('data-args', '{"command":"pwd"}');
    expect(probe).toHaveAttribute('data-view-mode', 'terminal');
    expect(probe).toHaveAttribute('data-has-content', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
    expect(probe).toHaveAttribute('data-view-mode', 'code');
    expect(probe).toHaveAttribute('data-has-content', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Show terminal' }));
    expect(probe).toHaveAttribute('data-view-mode', 'terminal');
    expect(probe).toHaveAttribute('data-has-content', 'false');
  });

  it('treats command and text output as terminal-only content', () => {
    renderSubject({
      name: 'run_command',
      status: 'running',
      expanded: false,
      onToggle: () => {},
      command: 'pnpm test',
      resultText: 'passed',
    });

    const probe = screen.getByTestId('sandbox-probe');
    expect(probe).toHaveAttribute('data-command', 'pnpm test');
    expect(probe).toHaveAttribute('data-result-text', 'passed');
    expect(probe).toHaveAttribute('data-has-content', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
    expect(probe).toHaveAttribute('data-has-content', 'false');
  });

  it('keeps structured result JSON available in both views', () => {
    renderSubject({
      name: 'run_command',
      status: 'error',
      expanded: true,
      onToggle: () => {},
      resultJson: '{"exit_code":1}',
    });

    const probe = screen.getByTestId('sandbox-probe');
    expect(probe).toHaveAttribute('data-result-json', '{"exit_code":1}');
    expect(probe).toHaveAttribute('data-has-content', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Show code' }));
    expect(probe).toHaveAttribute('data-has-content', 'true');
  });
});
