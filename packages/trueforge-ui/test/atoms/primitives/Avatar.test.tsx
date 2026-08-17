import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Avatar, AvatarFallback, AvatarImage } from '@/atoms/primitives/Avatar.js';

describe('Avatar', () => {
  it('applies the selected size and forwards host attributes', () => {
    render(<Avatar size="lg" className="host-avatar" aria-label="Ada Lovelace" />);

    const avatar = screen.getByLabelText('Ada Lovelace');
    expect(avatar).toHaveAttribute('data-slot', 'avatar');
    expect(avatar).toHaveAttribute('data-size', 'lg');
    expect(avatar).toHaveClass('h-10', 'w-10', 'host-avatar');
  });
});

describe('AvatarImage', () => {
  it('renders its source and accessible alternative text', () => {
    render(<AvatarImage src="/ada.png" alt="Ada Lovelace" className="host-image" />);

    const image = screen.getByRole('img', { name: 'Ada Lovelace' });
    expect(image).toHaveAttribute('src', '/ada.png');
    expect(image).toHaveAttribute('data-slot', 'avatar-image');
    expect(image).toHaveClass('object-cover', 'host-image');
  });

  it('calls the host error handler and removes a failed image', () => {
    const onError = vi.fn();
    render(<AvatarImage src="/missing.png" alt="Missing avatar" onError={onError} />);

    fireEvent.error(screen.getByRole('img', { name: 'Missing avatar' }));

    expect(onError).toHaveBeenCalledOnce();
    expect(screen.queryByRole('img', { name: 'Missing avatar' })).not.toBeInTheDocument();
  });

  it('does not render an image without a source', () => {
    const { container } = render(<AvatarImage alt="No source" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('AvatarFallback', () => {
  it('renders fallback content and forwards host attributes', () => {
    render(
      <AvatarFallback className="host-fallback" aria-label="Ada initials">
        AL
      </AvatarFallback>,
    );

    const fallback = screen.getByLabelText('Ada initials');
    expect(fallback).toHaveTextContent('AL');
    expect(fallback).toHaveAttribute('data-slot', 'avatar-fallback');
    expect(fallback).toHaveClass('host-fallback');
  });
});
