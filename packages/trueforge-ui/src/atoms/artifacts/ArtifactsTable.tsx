'use client';

import { Icon } from '../../icons/Icon.js';
import type { Artifact } from '../../server/types.js';
import { CreatedByCell } from '../CreatedByCell.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { formatRelativeTime } from '../lib/dateFormat.js';
import { DropdownMenu } from '../primitives/DropdownMenu.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table.js';
import { RowActionItem } from '../RowActionItem.js';
import { artifactPreviewKey } from './artifactDisplay.js';

export type ArtifactsTableProps = {
  artifacts: Artifact[];
  selectedKey: string | undefined;
  onOpen: (artifact: Artifact) => void;
  onDownload: (artifact: Artifact) => void;
  onEdit: (artifact: Artifact) => void;
};

export function ArtifactsTable({ artifacts, selectedKey, onOpen, onDownload, onEdit }: ArtifactsTableProps) {
  return (
    <Table className="min-w-160">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Created by</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="w-16" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map(artifact => {
          return (
            <TableRow
              key={artifact.id}
              className={cn(
                'cursor-pointer',
                artifactPreviewKey(artifact) === selectedKey && 'bg-secondary-button-hover',
              )}
              onClick={() => onOpen(artifact)}
            >
              <TableCell>
                <span className="truncate font-medium text-text-primary">{artifact.name}</span>
              </TableCell>
              <TableCell>
                <CreatedByCell subject={artifact.createdBySubject} />
              </TableCell>
              <TableCell className="text-sm text-text-secondary">{formatRelativeTime(artifact.updatedAt)}</TableCell>
              {/* Swallow here so menu clicks do not also open the preview. */}
              <TableCell onClick={event => event.stopPropagation()}>
                <DropdownMenu
                  align="end"
                  className="min-w-44"
                  trigger={
                    <button
                      type="button"
                      className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                      aria-label={`Actions for ${artifact.name}`}
                    >
                      <Icon name="ellipsis-vertical" className="size-3.5" />
                    </button>
                  }
                >
                  <RowActionItem label="Edit" icon="pencil" reason={undefined} onClick={() => onEdit(artifact)} />
                  <RowActionItem label="Open" icon="file" reason={undefined} onClick={() => onOpen(artifact)} />
                  <RowActionItem
                    label="Download"
                    icon="download"
                    reason={undefined}
                    onClick={() => onDownload(artifact)}
                  />
                </DropdownMenu>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
