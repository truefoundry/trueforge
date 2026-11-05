import { Children, Fragment, isValidElement, type ReactNode } from 'react';

import { useSlot } from '../../theme/SlotsProvider.js';
import { cn } from '../lib/cn.js';

export type StepTreeItemProps = {
  children: ReactNode;
  /** Use `false` for plain content (text, images) that sits in the tree without its own connector. */
  branch?: boolean;
  /** Use when the following steps live in a sibling container this row cannot see, so the line must reach its bottom. */
  continuesBelow?: boolean;
  className?: string;
};

/**
 * One row of a step tree. Use it directly when the caller renders rows itself (e.g. GroupedParts callbacks);
 * rows must be direct DOM siblings in a flex column so each one can see whether a later branch follows it.
 */
export function StepTreeItem({ children, branch = true, continuesBelow = false, className }: StepTreeItemProps) {
  // The vertical line runs the full row only while a later branch follows; on the last branch it stops at the
  // elbow, and plain content after the last branch draws no line. The elbow is pinned to the header row (py-1 +
  // half of the 1.25rem row) so expanding a step grows it downward without moving its branch. When a part
  // renders nothing (e.g. an unanswered ask-user prompt in live chat) we hide the row instead of an empty branch.
  return (
    <div
      data-slot="step-tree-item"
      data-branch={branch ? 'true' : 'false'}
      className={cn(
        'group/step-tree-item relative flex min-w-0 has-[>[data-step-tree-content]:empty]:hidden',
        className,
      )}
    >
      <div className="relative w-5 shrink-0 self-stretch">
        <div
          className={cn(
            'absolute top-0 left-1/2 w-px -translate-x-1/2 bg-border',
            continuesBelow
              ? 'bottom-0'
              : branch
                ? 'h-[0.875rem] group-[:has(~[data-branch=true])]/step-tree-item:bottom-0 group-[:has(~[data-branch=true])]/step-tree-item:h-auto'
                : 'hidden group-[:has(~[data-branch=true])]/step-tree-item:bottom-0 group-[:has(~[data-branch=true])]/step-tree-item:block',
          )}
        />
        {branch && <div className="absolute top-[0.875rem] right-0 left-1/2 h-px bg-border" />}
      </div>
      <div data-step-tree-content className={cn('min-w-0 flex-1', branch && 'py-1 [&>*]:mt-0')}>
        {children}
      </div>
    </div>
  );
}

export type StepTreeProps = {
  children: ReactNode;
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

/** Use when the children are already separate steps (e.g. a parallel tool group), so each one gets a branch. */
export function StepTree({ children, className, dataTestPrefix }: StepTreeProps) {
  const StepTreeItemSlot = useSlot('StepTreeItem');
  const items = flattenFragments(children);
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn('flex min-w-0 flex-col', className)}
      data-slot="step-tree"
      data-testid={dataTestPrefix ? `${dataTestPrefix}-step-tree` : undefined}
    >
      {items.map((child, index) => (
        <StepTreeItemSlot key={index}>{child}</StepTreeItemSlot>
      ))}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    StepTree: typeof StepTree;
    StepTreeItem: typeof StepTreeItem;
  }
}
