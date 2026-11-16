// @vitest-environment jsdom
import { ThreadPrimitive, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThreadContainer } from '@/containers/ThreadContainer.js';
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

  it('sends Save & Rerun from the click without also submitting the form', async () => {
    Element.prototype.scrollTo = () => {};
    const onEdit = vi.fn<(message: AppendMessage) => Promise<void>>(async () => {});
    render(
      <RuntimeHarness
        messages={[
          { role: 'user', id: 'turn-1-user', content: 'hello' },
          { role: 'assistant', id: 'turn-1-assistant', content: 'hi', status: { type: 'complete', reason: 'stop' } },
        ]}
        onEdit={onEdit}
      >
        <ThreadContainer />
      </RuntimeHarness>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText('Edit message'), { target: { value: 'hello again' } });
    const save = screen.getByRole('button', { name: 'Save & Rerun' });
    // Browsers submit after the click's microtasks have closed the edit composer.
    const onSubmit = vi.fn();
    save.closest('form')?.addEventListener('submit', onSubmit);

    fireEvent.click(save);

    await waitFor(() => expect(onEdit).toHaveBeenCalledOnce());
    expect(onSubmit).not.toHaveBeenCalled();
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
