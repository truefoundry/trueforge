import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ScrollToBottomButton } from '@/atoms/ScrollToBottomButton.js';

describe('ScrollToBottomButton', () => {
  it('forwards button props, invokes clicks, and exposes its positioning wrapper ref', () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLSpanElement>();
    render(<ScrollToBottomButton ref={ref} onClick={onClick} className="host-scroll-button" data-track="scroll" />);

    const button = screen.getByRole('button', { name: 'Scroll to bottom' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('title', 'Scroll to bottom');
    expect(button).toHaveAttribute('data-track', 'scroll');
    expect(button).toHaveClass('aui-thread-scroll-to-bottom', 'host-scroll-button');
    expect(button.querySelector('svg')).toHaveClass('lucide-arrow-down');
    expect(ref.current).toBe(button.parentElement);

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render while disabled', () => {
    const onClick = vi.fn();
    const { container } = render(<ScrollToBottomButton disabled onClick={onClick} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });
});
