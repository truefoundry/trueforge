// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StepTree, StepTreeItem } from '@/atoms/agent-chat/StepTree.js';

describe('StepTree', () => {
  it('gives every child its own branch, including children wrapped in a Fragment', () => {
    const { container } = render(
      <StepTree>
        <>
          <div>one</div>
          <div>two</div>
        </>
        <div>three</div>
      </StepTree>,
    );

    const items = container.querySelectorAll('[data-slot="step-tree-item"]');
    expect(Array.from(items, item => item.textContent)).toEqual(['one', 'two', 'three']);
  });

  it('renders nothing when there are no children', () => {
    const { container } = render(<StepTree>{null}</StepTree>);
    expect(container.querySelector('[data-slot="step-tree"]')).toBeNull();
  });

  it('draws an elbow only for branch rows, not for plain content rows', () => {
    const { container } = render(
      <div>
        <StepTreeItem>tool</StepTreeItem>
        <StepTreeItem branch={false}>text</StepTreeItem>
      </div>,
    );

    const rows = container.querySelectorAll('[data-slot="step-tree-item"]');
    expect(Array.from(rows, row => row.getAttribute('data-branch'))).toEqual(['true', 'false']);
    expect(rows[0]?.querySelector('.top-\\[0\\.875rem\\]')).not.toBeNull();
    expect(rows[1]?.querySelector('.top-\\[0\\.875rem\\]')).toBeNull();
  });
});
