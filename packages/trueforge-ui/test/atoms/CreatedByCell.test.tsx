import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CreatedByCell } from '@/atoms/CreatedByCell.js';

describe('CreatedByCell', () => {
  it('renders a dash when subject is missing', () => {
    render(<CreatedByCell subject={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders initials avatar and display name', () => {
    const { container } = render(
      <CreatedByCell
        subject={{
          subjectId: 'u1',
          subjectType: 'user',
          subjectDisplayName: 'alice@example.com',
        }}
      />,
    );
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent('A');
  });
});
