'use client';

import { useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { Artifact } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { formatRelativeTime } from '../lib/dateFormat.js';
import { Badge } from '../primitives/Badge.js';
import { DropdownMenu, DropdownMenuSeparator } from '../primitives/DropdownMenu.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table.js';
import { RowActionItem } from '../RowActionItem.js';
import { artifactPreviewKey, artifactTypeLabel, NO_ENTRY_POINT_REASON } from './artifactDisplay.js';

export type ArtifactsTableProps = {
  artifacts: Artifact[];
  selectedKey: string | undefined;
  onOpen: (artifact: Artifact) => void;
  onDownload: (artifact: Artifact) => void;
  onEdit: (artifact: Artifact) => void;
  onDelete: (artifact: Artifact) => void;
  onShare: (artifact: Artifact) => void;
};

export function ArtifactsTable({
  artifacts,
  selectedKey,
  onOpen,
  onDownload,
  onEdit,
  onDelete,
  onShare,
}: ArtifactsTableProps) {
  const ShareSessionDialog = useSlot('ShareSessionDialog');
  const [sharing, setSharing] = useState<Artifact | null>(null);

  return (
    <Table className="min-w-160">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="w-16" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {artifacts.map(artifact => {
          const noEntryReason = artifact.entryPoint == null ? NO_ENTRY_POINT_REASON : undefined;
          return (
            <TableRow
              key={artifact.slug}
              className={cn(
                'cursor-pointer',
                artifactPreviewKey(artifact) === selectedKey && 'bg-secondary-button-hover',
              )}
              onClick={() => onOpen(artifact)}
            >
              <TableCell>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-text-primary">{artifact.title}</span>
                  <span className="truncate text-xs text-text-secondary">{artifact.slug}</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" shape="pill">
                  {artifactTypeLabel(artifact.entryPoint)}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">v{artifact.latestVersion}</TableCell>
              <TableCell className="text-sm text-text-secondary">{formatRelativeTime(artifact.updatedAt)}</TableCell>
              {/* Swallow here so menu clicks do not also open the preview. */}
              <TableCell className="relative" onClick={event => event.stopPropagation()}>
                <DropdownMenu
                  align="end"
                  className="min-w-44"
                  trigger={
                    <button
                      type="button"
                      className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
                      aria-label={`Actions for ${artifact.title}`}
                    >
                      <Icon name="ellipsis-vertical" className="size-3.5" />
                    </button>
                  }
                >
                  <RowActionItem label="Edit" icon="pencil" reason={undefined} onClick={() => onEdit(artifact)} />
                  <RowActionItem label="Open" icon="file" reason={noEntryReason} onClick={() => onOpen(artifact)} />
                  <RowActionItem
                    label="Download"
                    icon="download"
                    reason={noEntryReason}
                    onClick={() => onDownload(artifact)}
                  />
                  <RowActionItem
                    label="Share"
                    icon="share"
                    reason={undefined}
                    onClick={() => {
                      onShare(artifact);
                      setSharing(artifact);
                    }}
                  />
                  <DropdownMenuSeparator />
                  <RowActionItem
                    label="Delete"
                    icon="trash"
                    className="text-failure-bg focus-visible:text-failure-bg"
                    reason={undefined}
                    onClick={() => onDelete(artifact)}
                  />
                </DropdownMenu>
                {sharing?.id === artifact.id ? (
                  <ShareSessionDialog
                    sessionId={artifact.createdBySessionId}
                    open
                    onOpenChange={next => {
                      if (!next) setSharing(null);
                    }}
                    trigger={<span aria-hidden className="pointer-events-none absolute size-0" />}
                  />
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
