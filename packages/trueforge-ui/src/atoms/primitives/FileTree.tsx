'use client';

import { useMemo, useState, type ReactNode } from 'react';

import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';

type FileTreeNode<T> =
  | { kind: 'folder'; name: string; path: string; children: FileTreeNode<T>[] }
  | { kind: 'file'; name: string; key: string; item: T };

export type FileTreeProps<T> = {
  items: readonly T[];
  /** Slash-separated path; every segment but the last becomes a folder row. */
  getPath: (item: T) => string;
  getKey: (item: T) => string;
  renderItem: (args: { item: T; name: string }) => ReactNode;
  /** Folders start open unless this is false. */
  defaultExpanded?: boolean;
  className?: string;
};

const INDENT_REM = 0.75;

function buildTree<T>({
  items,
  getPath,
  getKey,
}: Pick<FileTreeProps<T>, 'items' | 'getPath' | 'getKey'>): FileTreeNode<T>[] {
  const root: FileTreeNode<T>[] = [];
  for (const item of items) {
    // A path like `a//b/` yields empty segments; dropping them keeps the file name non-empty.
    const segments = getPath(item)
      .split('/')
      .filter(segment => segment !== '');
    const fileName = segments.pop() ?? getPath(item);
    let level = root;
    let folderPath = '';
    for (const segment of segments) {
      folderPath = folderPath === '' ? segment : `${folderPath}/${segment}`;
      let folder = level.find(node => node.kind === 'folder' && node.name === segment);
      if (folder?.kind !== 'folder') {
        folder = { kind: 'folder', name: segment, path: folderPath, children: [] };
        level.push(folder);
      }
      level = folder.children;
    }
    level.push({ kind: 'file', name: fileName, key: getKey(item), item });
  }
  return root;
}

export function FileTree<T>({
  items,
  getPath,
  getKey,
  renderItem,
  defaultExpanded = true,
  className,
}: FileTreeProps<T>) {
  const tree = useMemo(() => buildTree({ items, getPath, getKey }), [items, getPath, getKey]);
  // Only folders the user toggled are stored; the rest follow `defaultExpanded`.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());

  const isOpen = (path: string) => (toggled.has(path) ? !defaultExpanded : defaultExpanded);
  const toggle = (path: string) =>
    setToggled(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = ({ nodes, depth }: { nodes: FileTreeNode<T>[]; depth: number }): ReactNode => (
    <ul className={cn('flex flex-col', depth === 0 && className)}>
      {nodes.map(node => {
        if (node.kind === 'file') {
          return (
            <li key={`file:${node.key}`} style={depth === 0 ? undefined : { paddingLeft: `${depth * INDENT_REM}rem` }}>
              {renderItem({ item: node.item, name: node.name })}
            </li>
          );
        }
        const open = isOpen(node.path);
        return (
          <li key={`folder:${node.path}`}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(node.path)}
              style={depth === 0 ? undefined : { paddingLeft: `${depth * INDENT_REM}rem` }}
              className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 text-left text-sm text-text-primary hover:bg-secondary-button-hover"
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="text-text-secondary" />
              <Icon name="folder" size={14} className="text-text-secondary" />
              <span className="truncate">{node.name}</span>
            </button>
            {open ? renderNodes({ nodes: node.children, depth: depth + 1 }) : null}
          </li>
        );
      })}
    </ul>
  );

  return renderNodes({ nodes: tree, depth: 0 });
}
