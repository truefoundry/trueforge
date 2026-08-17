// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UserEditComposerContainer } from '@/containers/UserEditComposerContainer.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function renderEditComposer(messages: ThreadMessageLike[]) {
  return render(
    <RuntimeHarness messages={messages}>
      <ThreadPrimitive.Messages>{() => <UserEditComposerContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>,
  );
}

describe('UserEditComposerContainer', () => {
  it('renders a text input with cancel and save & rerun actions', () => {
    renderEditComposer([{ role: 'user', content: 'edit me', id: 'turn-1-user' }]);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & Rerun' })).toBeInTheDocument();
    expect(screen.getByRole('textbox').closest('form')).toBeTruthy();
  });

  it('submits the edit form on Enter', () => {
    renderEditComposer([{ role: 'user', content: 'edit me', id: 'turn-1-user' }]);

    const input = screen.getByRole('textbox');
    const form = input.closest('form');
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Expected edit input to be rendered inside a form');
    }
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', onSubmit);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('shows read-only attachments without remove controls', () => {
    renderEditComposer([
      {
        role: 'user',
        content: 'What is this?',
        id: 'turn-1-user',
        attachments: [
          {
            id: 'att-1',
            type: 'image',
            name: 'logo.png',
            contentType: 'image/png',
            status: { type: 'complete' },
            content: [
              {
                type: 'image',
                image: 'data:image/png;base64,iVBORw0KGgo=',
                filename: 'logo.png',
              },
            ],
          },
        ],
      },
    ]);
    expect(screen.getByAltText('logo.png')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});
