// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ToolApprovalBarProps } from '@/atoms/ToolApprovalBar.js';
import { ToolApprovalContainer, type ToolApprovalOption } from '@/containers/ToolApprovalContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function ToolApprovalBarProbe({
  toolName,
  approveOptions,
  denyOptions,
  selectedDenyOption,
  denialReason,
  showReasonError,
  onSelect,
  onDenyOptionChange,
  onDenialReasonChange,
  onReasonSubmit,
}: ToolApprovalBarProps) {
  return (
    <section
      data-testid="approval-probe"
      data-tool-name={toolName}
      data-approve-variants={approveOptions?.map(option => option.variant).join('|')}
      data-deny-requires-reason={denyOptions?.map(option => String(option.requiresReason)).join('|')}
      data-selected-deny={selectedDenyOption?.id ?? ''}
      data-show-reason-error={String(showReasonError)}
    >
      {approveOptions?.map(option => (
        <button key={option.id} type="button" onClick={() => onSelect(option.id)}>
          {option.label}
        </button>
      ))}
      {denyOptions?.map(option => (
        <button
          key={option.id}
          type="button"
          onClick={() => {
            if (option.requiresReason) {
              onDenyOptionChange?.(option.id);
            } else {
              onSelect(option.id);
            }
          }}
        >
          {option.label}
        </button>
      ))}
      {selectedDenyOption !== undefined ? (
        <>
          <div>{selectedDenyOption.confirm?.title}</div>
          <div>{selectedDenyOption.confirm?.description}</div>
          <div>{selectedDenyOption.grants?.join(',')}</div>
          <input
            aria-label="Denial reason"
            value={denialReason}
            onChange={event => onDenialReasonChange?.(event.target.value)}
          />
          <button type="button" onClick={onReasonSubmit}>
            Submit denial
          </button>
        </>
      ) : null}
    </section>
  );
}

const options: ToolApprovalOption[] = [
  { id: 'allow-once', label: 'Allow once', isAllow: true },
  { id: 'allow-session', label: 'Allow session', isAllow: true },
  { id: 'reject-now', label: 'Reject now', isAllow: false },
  {
    id: 'reject-with-reason',
    label: 'Reject with reason',
    isAllow: false,
    grants: ['filesystem:write'],
    confirm: {
      title: 'Explain rejection',
      description: 'The agent will receive this reason.',
    },
  },
];

function renderSubject(
  onSelectOption: (optionId: string, reason?: string) => void,
  props: { toolName?: string; argsText?: string } = { toolName: 'shell' },
) {
  return render(
    <SlotsProvider overrides={{ ToolApprovalBar: ToolApprovalBarProbe }}>
      <ToolApprovalContainer
        toolName={props.toolName}
        argsText={props.argsText}
        options={options}
        onSelectOption={onSelectOption}
      />
    </SlotsProvider>,
  );
}

describe('ToolApprovalContainer', () => {
  it('maps allow and deny options and forwards immediate selections', () => {
    const onSelectOption = vi.fn();
    renderSubject(onSelectOption);

    const probe = screen.getByTestId('approval-probe');
    expect(probe).toHaveAttribute('data-tool-name', 'shell');
    expect(probe).toHaveAttribute('data-approve-variants', 'primary|secondary');
    expect(probe).toHaveAttribute('data-deny-requires-reason', 'false|true');

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject now' }));
    expect(onSelectOption).toHaveBeenNthCalledWith(1, 'allow-once');
    expect(onSelectOption).toHaveBeenNthCalledWith(2, 'reject-now');
  });

  it('shows MCP inner tool name with server when args include both fields', () => {
    const onSelectOption = vi.fn();
    renderSubject(onSelectOption, {
      toolName: 'call_tool',
      argsText: JSON.stringify({ mcp_server: 'github', tool_name: 'search' }),
    });

    expect(screen.getByTestId('approval-probe')).toHaveAttribute('data-tool-name', 'search (github)');
  });

  it('falls back to toolName when MCP fields are missing', () => {
    const onSelectOption = vi.fn();
    renderSubject(onSelectOption, {
      toolName: 'shell',
      argsText: JSON.stringify({ command: 'ls' }),
    });

    expect(screen.getByTestId('approval-probe')).toHaveAttribute('data-tool-name', 'shell');
  });

  it('requires, trims, and submits a denial reason with confirmation metadata', () => {
    const onSelectOption = vi.fn();
    renderSubject(onSelectOption);

    fireEvent.click(screen.getByRole('button', { name: 'Reject with reason' }));

    const probe = screen.getByTestId('approval-probe');
    expect(probe).toHaveAttribute('data-selected-deny', 'reject-with-reason');
    expect(screen.getByText('Explain rejection')).toBeInTheDocument();
    expect(screen.getByText('The agent will receive this reason.')).toBeInTheDocument();
    expect(screen.getByText('filesystem:write')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit denial' }));
    expect(onSelectOption).not.toHaveBeenCalled();
    expect(probe).toHaveAttribute('data-show-reason-error', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: 'Denial reason' }), {
      target: { value: '  policy blocked  ' },
    });
    expect(probe).toHaveAttribute('data-show-reason-error', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Submit denial' }));
    expect(onSelectOption).toHaveBeenCalledWith('reject-with-reason', 'policy blocked');
    expect(probe).toHaveAttribute('data-selected-deny', '');
  });
});
