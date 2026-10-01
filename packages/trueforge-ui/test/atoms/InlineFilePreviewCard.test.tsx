// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineFilePreviewCard } from '@/atoms/InlineFilePreviewCard.js';

describe('InlineFilePreviewCard', () => {
  it('shows a scaled html thumbnail and enlarges from the card or the button', () => {
    const onEnlarge = vi.fn();
    render(
      <InlineFilePreviewCard
        name="Metrics redesign"
        enlarged={false}
        view={{ status: 'html', text: '<h1>Metrics</h1>' }}
        onEnlarge={onEnlarge}
        onDownload={vi.fn()}
      />,
    );

    const thumbnail = screen.getByTitle('Thumbnail of Metrics redesign');
    expect(thumbnail).toHaveAttribute('sandbox', 'allow-scripts');
    expect(thumbnail.getAttribute('sandbox')).not.toContain('allow-popups');
    expect(thumbnail.getAttribute('sandbox')).not.toContain('allow-forms');
    expect(thumbnail).toHaveAttribute('srcdoc', '<h1>Metrics</h1>');
    expect(screen.getByText('Metrics redesign')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge preview of Metrics redesign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge Metrics redesign' }));
    expect(onEnlarge).toHaveBeenCalledTimes(2);
  });
});
