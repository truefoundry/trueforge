// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SandboxToolCallCard } from '@/atoms/SandboxToolCallCard.js';

vi.mock('@/atoms/MonacoEditorCore.js', () => ({
  MonacoEditorCore: ({ value, options }: { value: string; options?: Record<string, unknown> }) => (
    <div data-testid="sandbox-json" data-read-only={String(options?.readOnly)}>
      {value}
    </div>
  ),
}));

describe('SandboxToolCallCard', () => {
  it('uses intent as the title, reports running duration, and toggles expansion', () => {
    const onToggle = vi.fn();
    render(
      <SandboxToolCallCard
        name="run_command"
        intent="Install dependencies"
        status="running"
        expanded={false}
        onToggle={onToggle}
        durationText="3s"
        hasContent
        command="pnpm install"
      />,
    );

    expect(screen.getByText('Install dependencies')).toBeInTheDocument();
    expect(screen.getByText('3s')).toBeInTheDocument();
    expect(screen.queryByText('pnpm install')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand step' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders terminal output, exit status, and controlled view-mode callbacks', () => {
    const onViewModeChange = vi.fn();
    render(
      <SandboxToolCallCard
        name="run_command"
        status="success"
        expanded
        onToggle={() => {}}
        command="echo hello"
        resultText="hello"
        exitCode={0}
        hasContent
        viewMode="terminal"
        onViewModeChange={onViewModeChange}
        dataTestPrefix="sandbox"
      />,
    );

    expect(screen.getByText('echo hello')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-exit-code')).toHaveTextContent('exit: 0');
    expect(screen.getByRole('button', { name: 'Terminal View' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Code View' }));
    expect(onViewModeChange).toHaveBeenCalledWith('code');
  });

  it('renders read-only argument and result JSON in code view', () => {
    const { container } = render(
      <SandboxToolCallCard
        name="run_command"
        status="error"
        expanded
        onToggle={() => {}}
        argsJson='{"command":"false"}'
        resultJson='{"error":"failed"}'
        exitCode={1}
        hasContent
        viewMode="code"
        dataTestPrefix="sandbox"
      />,
    );

    expect(screen.getByText('Arguments')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getAllByTestId('sandbox-json')).toHaveLength(2);
    for (const editor of screen.getAllByTestId('sandbox-json')) {
      expect(editor).toHaveAttribute('data-read-only', 'true');
    }
    expect(container.querySelector('svg.text-failure-bg')).toBeInTheDocument();
    expect(screen.getByTestId('sandbox-exit-code')).toHaveTextContent('exit: 1');
  });

  it('keeps the sandbox body empty when hasContent is false', () => {
    render(
      <SandboxToolCallCard
        name="run_command"
        status="success"
        expanded
        onToggle={() => {}}
        command="hidden command"
        resultText="hidden result"
        hasContent={false}
        dataTestPrefix="sandbox"
      />,
    );

    expect(screen.getByTestId('sandbox-sandbox')).toBeInTheDocument();
    expect(screen.queryByText('hidden command')).not.toBeInTheDocument();
    expect(screen.queryByText('hidden result')).not.toBeInTheDocument();
  });
});
