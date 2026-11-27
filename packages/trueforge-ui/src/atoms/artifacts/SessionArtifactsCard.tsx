'use client';

import { useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import type { Artifact } from '../../server/types.js';
import { cn } from '../lib/cn.js';
import { FileTree } from '../primitives/FileTree.js';
import { artifactPreviewKey, artifactType } from './artifactDisplay.js';

/** Rows shown before "Show N more", so a long session does not cover the chat. */
export const SESSION_ARTIFACTS_VISIBLE_COUNT = 6;

export type SessionArtifactsCardProps = {
  artifacts: Artifact[];
  selectedKey: string | undefined;
  onOpen: (artifact: Artifact) => void;
  onShowMore?: () => void;
  className?: string;
};

const getArtifactPath = (artifact: Artifact) => artifact.name;
const getArtifactKey = (artifact: Artifact) => artifact.id;

export function SessionArtifactsCard({
  artifacts,
  selectedKey,
  onOpen,
  onShowMore,
  className,
}: SessionArtifactsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(artifacts.length - SESSION_ARTIFACTS_VISIBLE_COUNT, 0);
  const visible = expanded ? artifacts : artifacts.slice(0, SESSION_ARTIFACTS_VISIBLE_COUNT);

  return (
    <section
      aria-label="Session artifacts"
      className={cn(
        'flex max-h-[70vh] w-72 flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-card-bg p-3 shadow-sm',
        className,
      )}
    >
      <h2 className="px-1 text-xs font-medium text-text-secondary">Artifacts</h2>
      <FileTree
        items={visible}
        getPath={getArtifactPath}
        getKey={getArtifactKey}
        renderItem={({ item, name }) => {
          const type = artifactType(item);
          return (
            <button
              type="button"
              title={item.name}
              onClick={() => onOpen(item)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs text-text-primary hover:bg-secondary-button-hover',
                artifactPreviewKey(item) === selectedKey && 'bg-secondary-button-hover',
              )}
            >
              <Icon name={type.icon} size={14} className="text-primary-button-bg" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="shrink-0 text-[0.625rem] text-text-secondary">{type.label}</span>
            </button>
          );
        }}
      />
      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            if (!expanded) onShowMore?.();
            setExpanded(current => !current);
          }}
          className="w-fit cursor-pointer px-1 pt-1 text-xs text-text-secondary hover:text-text-primary"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </section>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    SessionArtifactsCard: typeof SessionArtifactsCard;
  }
}
