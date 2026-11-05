import { Children, Fragment, isValidElement, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export type StepTreeProps = {
  children: ReactNode;
  /** Use `branch` when each child is its own step, so each gets an L-connector; use `rail` when children are one opaque block that only needs a stem. */
  variant?: 'branch' | 'rail';
  className?: string;
  dataTestPrefix?: string;
};

// This happens when GroupedParts passes a group's parts inside a Fragment; Children.toArray keeps that as one
// node, so we unwrap it to give every part its own branch.
function flattenFragments(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flattenFragments(child.props.children)
      : [child],
  );
}

export function StepTree({ children, variant = 'branch', className, dataTestPrefix }: StepTreeProps) {
  if (variant === 'rail') {
    return (
      <div
        className={cn('flex min-w-0 gap-3', className)}
        data-slot="step-tree"
        data-variant="rail"
        data-testid={dataTestPrefix ? `${dataTestPrefix}-step-tree` : undefined}
      >
        <div className="flex w-3 shrink-0 justify-center self-stretch">
          <div className="w-px bg-border" />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }

  const items = flattenFragments(children);
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn('flex min-w-0 flex-col', className)}
      data-slot="step-tree"
      data-variant="branch"
      data-testid={dataTestPrefix ? `${dataTestPrefix}-step-tree` : undefined}
    >
      {items.map((child, index) => {
        const isLast = index === items.length - 1;
        // When a child expands, the item grows taller; we pin the elbow to the header row (py-1 + half of the
        // 1.25rem row) and drop the child's top margin, so the branch stays on the tool name.
        return (
          <div key={index} className="relative flex min-w-0">
            <div className="relative w-3 shrink-0 self-stretch">
              <div
                className={cn(
                  'absolute left-1/2 w-px -translate-x-1/2 bg-border',
                  isLast ? 'top-0 h-[0.875rem]' : 'inset-y-0',
                )}
              />
              <div className="absolute top-[0.875rem] left-1/2 h-px w-[0.5rem] bg-border" />
            </div>
            <div className="min-w-0 flex-1 py-1 [&>*]:mt-0">{child}</div>
          </div>
        );
      })}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    StepTree: typeof StepTree;
  }
}
