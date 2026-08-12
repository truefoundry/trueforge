import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssistantMessageBubble } from '@/atoms/AssistantMessageBubble.js';

describe('AssistantMessageBubble', () => {
  it('renders message, error, and action content in their regions', () => {
    const { container } = render(
      <AssistantMessageBubble
        error={<span>Generation failed</span>}
        actionBar={<button type="button">Copy response</button>}
        className="host-bubble"
      >
        <p>Assistant response</p>
      </AssistantMessageBubble>,
    );

    const root = container.querySelector('[data-slot="aui_assistant-message-root"]');
    expect(root).toHaveClass('host-bubble');
    expect(root).toContainElement(screen.getByText('Assistant response'));
    expect(screen.getByText('Generation failed').parentElement).toHaveClass('text-failure-bg');
    expect(screen.getByRole('button', { name: 'Copy response' }).parentElement).toHaveClass('mt-1');
  });

  it('omits optional regions when their values are absent', () => {
    const { container } = render(<AssistantMessageBubble>Only the message</AssistantMessageBubble>);

    expect(screen.getByText('Only the message')).toBeInTheDocument();
    expect(container.querySelector('.text-failure-bg')).not.toBeInTheDocument();
    expect(container.querySelector('.mt-1')).not.toBeInTheDocument();
  });
});
