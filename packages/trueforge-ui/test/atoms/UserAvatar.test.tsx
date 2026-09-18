import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getUserInitials, UserAvatar } from '@/atoms/UserAvatar.js';
import { CurrentUserProvider } from '@/contexts/CurrentUserContext.js';

describe('getUserInitials', () => {
  it.each([
    ['Ada Lovelace', 'A'],
    ['Ada King Lovelace', 'A'],
    ['Ada', 'A'],
    ['bob', 'B'],
    ['  ada   lovelace  ', 'A'],
    ['', ''],
    ['   ', ''],
  ])('returns the first character for %j', (displayName, expected) => {
    expect(getUserInitials(displayName)).toBe(expected);
  });
});

describe('UserAvatar', () => {
  it('shows the first character with the full display name underneath', () => {
    render(
      <CurrentUserProvider currentUser={{ displayName: 'Ada Lovelace' }}>
        <UserAvatar labeled />
      </CurrentUserProvider>,
    );

    const avatar = screen.getByLabelText('Ada Lovelace');
    expect(avatar).toHaveTextContent('A');
    expect(avatar).toHaveTextContent('Ada Lovelace');
    expect(avatar).toHaveAttribute('title', 'Ada Lovelace');
    expect(avatar).toHaveClass('w-14.5');
  });

  it('shows only the avatar glyph when unlabeled', () => {
    render(
      <CurrentUserProvider currentUser={{ displayName: 'Ada Lovelace' }}>
        <UserAvatar />
      </CurrentUserProvider>,
    );

    const avatar = screen.getByLabelText('Ada Lovelace');
    expect(avatar.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent(/^A$/);
    expect(avatar).not.toHaveTextContent('Ada Lovelace');
    expect(avatar).toHaveAttribute('title', 'Ada Lovelace');
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
