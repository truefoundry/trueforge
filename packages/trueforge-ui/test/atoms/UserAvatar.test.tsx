import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getUserInitials, UserAvatar } from '@/atoms/UserAvatar.js';
import { CurrentUserProvider } from '@/contexts/CurrentUserContext.js';

describe('getUserInitials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['Ada King Lovelace', 'AL'],
    ['Ada', 'AD'],
    ['Ada Ada', 'AA'],
    ['  ada   lovelace  ', 'AL'],
    ['', ''],
    ['   ', ''],
  ])('returns initials for %j', (displayName, expected) => {
    expect(getUserInitials(displayName)).toBe(expected);
  });
});

describe('UserAvatar', () => {
  it('shows initials with the full display name underneath', () => {
    render(
      <CurrentUserProvider currentUser={{ displayName: 'Ada Lovelace' }}>
        <UserAvatar labeled />
      </CurrentUserProvider>,
    );

    const avatar = screen.getByLabelText('Ada Lovelace');
    expect(avatar).toHaveTextContent('AL');
    expect(avatar).toHaveTextContent('Ada Lovelace');
    expect(avatar).toHaveAttribute('title', 'Ada Lovelace');
    expect(avatar).toHaveClass('w-14.5');
  });

  it('renders nothing without a non-empty display name', () => {
    const { container, rerender } = render(<UserAvatar />);
    expect(container).toBeEmptyDOMElement();

    rerender(
      <CurrentUserProvider currentUser={{ displayName: '   ' }}>
        <UserAvatar />
      </CurrentUserProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
