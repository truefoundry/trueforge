import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserMessageBubble } from '@/atoms/UserMessageBubble.js';

describe('UserMessageBubble', () => {
  it('renders message content, attachments, and an edit action in their semantic slots', () => {
    const { container } = render(
      <UserMessageBubble
        text={'First line\nSecond line'}
        attachments={<a href="/brief.pdf">brief.pdf</a>}
        editAction={<button type="button">Edit message</button>}
        className="consumer-class"
      />,
    );

    const root = container.querySelector('[data-slot="aui_user-message-root"]');
    const content = container.querySelector('[data-slot="aui_user-message-content"]');

    expect(root).toHaveClass('consumer-class');
    expect(content).toHaveTextContent('First line Second line');
    expect(content).toHaveStyle({ borderRadius: 'var(--composer-radius, 1.5rem)' });
    expect(screen.getByRole('link', { name: 'brief.pdf' })).toHaveAttribute('href', '/brief.pdf');
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeInTheDocument();
  });

  it('omits optional attachment and edit-action content', () => {
    render(<UserMessageBubble text="Just text" />);

    expect(screen.getByText('Just text')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
