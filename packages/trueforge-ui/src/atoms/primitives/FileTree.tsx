'use client';

import { cn } from '../lib/cn.js';

export type FileTreeItem = {
  path: string;
  detail?: string;
};

export type FileTreeProps = {
  files: readonly FileTreeItem[];
  selectedPath?: string;
  onSelect?: (path: string) => void;
};

/** Read-only list of bundle paths. Selecting a row is optional. */
export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  return (
    <ul className="m-0 list-none p-0 text-sm">
      {files.map(file => {
        const selected = file.path === selectedPath;
        const content = (
          <>
            <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
            {file.detail != null ? <span className="shrink-0 text-text-secondary">{file.detail}</span> : null}
          </>
        );
        return (
          <li key={file.path}>
            {onSelect == null ? (
              <div className="flex items-center gap-3 px-2 py-1">{content}</div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(file.path)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-secondary-button-hover',
                  selected && 'bg-secondary-button-hover',
                )}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
