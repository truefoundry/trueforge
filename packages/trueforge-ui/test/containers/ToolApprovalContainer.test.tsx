// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RespondToToolApprovalOptions } from '@truefoundry/trueforge-assistant-ui-runtime';

import type { ToolApprovalBarProps } from '@/atoms/ToolApprovalBar.js';
import { ToolApprovalContainer } from '@/containers/ToolApprovalContainer.js';
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

function renderSubject(
  onRespond: (response: RespondToToolApprovalOptions) => Promise<void>,
  props: { toolName?: string; argsText?: string } = { toolName: 'shell' },
) {
  return render(
    <SlotsProvider overrides={{ ToolApprovalBar: ToolApprovalBarProbe }}>
      <ToolApprovalContainer
        approvalId="approval-1"
        toolName={props.toolName}
        argsText={props.argsText}
        onRespond={onRespond}
      />
    </SlotsProvider>,
  );
}

describe('ToolApprovalContainer', () => {
  it('maps the canonical allow and deny options', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    renderSubject(onRespond);

    const probe = screen.getByTestId('approval-probe');
    expect(probe).toHaveAttribute('data-tool-name', 'shell');
    expect(probe).toHaveAttribute('data-approve-variants', 'primary|secondary|secondary');
    expect(probe).toHaveAttribute('data-deny-requires-reason', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith({ approvalId: 'approval-1', approved: true }));
  });

  it('shows MCP inner tool name with server when args include both fields', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    renderSubject(onRespond, {
      toolName: 'call_tool',
      argsText: JSON.stringify({ mcp_server: 'github', tool_name: 'search' }),
    });

    expect(screen.getByTestId('approval-probe')).toHaveAttribute('data-tool-name', 'search (github)');
  });

  it('falls back to toolName when MCP fields are missing', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    renderSubject(onRespond, {
      toolName: 'shell',
      argsText: JSON.stringify({ command: 'ls' }),
    });

    expect(screen.getByTestId('approval-probe')).toHaveAttribute('data-tool-name', 'shell');
  });

  it('requires, trims, and submits a denial reason with confirmation metadata', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    renderSubject(onRespond);

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    const probe = screen.getByTestId('approval-probe');
    expect(probe).toHaveAttribute('data-selected-deny', 'deny');

    fireEvent.click(screen.getByRole('button', { name: 'Submit denial' }));
    expect(onRespond).not.toHaveBeenCalled();
    expect(probe).toHaveAttribute('data-show-reason-error', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: 'Denial reason' }), {
      target: { value: '  policy blocked  ' },
    });
    expect(probe).toHaveAttribute('data-show-reason-error', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Submit denial' }));
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        approvalId: 'approval-1',
        approved: false,
        reason: 'policy blocked',
      }),
    );
    await waitFor(() => expect(probe).toHaveAttribute('data-selected-deny', ''));
  });
});
