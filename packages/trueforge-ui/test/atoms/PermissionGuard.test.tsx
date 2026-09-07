// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PermissionGuard } from '@/atoms/PermissionGuard.js';

describe('PermissionGuard', () => {
  it('preserves allowed controls and explains disabled controls', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <PermissionGuard allowed>
        <button type="button" onClick={onClick}>
          Update
        </button>
      </PermissionGuard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <PermissionGuard allowed={false} deniedMessage="Missing MANAGE permission">
        <button type="button" onClick={onClick}>
          Update
        </button>
      </PermissionGuard>,
    );
    const button = screen.getByRole('button', { name: 'Update' });
    expect(button).toBeDisabled();
    fireEvent.mouseEnter(button.parentElement ?? button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Missing MANAGE permission');
  });
});
