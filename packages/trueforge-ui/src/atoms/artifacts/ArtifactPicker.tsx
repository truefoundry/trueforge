'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Icon } from '../../icons/Icon.js';
import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useArtifactServer } from '../../server/ServerContext.js';
import type { Artifact, ListArtifactsParams } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';
import { getAttachmentFileIconName } from '../AttachmentCard.js';
import { cn } from '../lib/cn.js';
import { formatRelativeTime } from '../lib/dateFormat.js';
import { auiSelectOptionClass } from '../lib/selectClasses.js';
import SearchInput from '../primitives/SearchInput.js';
import { Skeleton } from '../primitives/Skeleton.js';

const SEARCH_DEBOUNCE_MS = 300;
// The list API rejects a `limit` above 25. ponytail: only the first page is listed; page on `nextPageToken` if users outgrow it.
const PICKER_PAGE_SIZE = 25;

export type ArtifactPickerProps = {
  selected: readonly Artifact[];
  onChange: (next: Artifact[]) => void;
  onDone: () => void;
};

export function ArtifactPicker({ selected, onChange, onDone }: ArtifactPickerProps) {
  const artifactServer = useArtifactServer();
  const queryClient = useServerQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setName(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const listParams: ListArtifactsParams = { limit: PICKER_PAGE_SIZE, ...(name === '' ? {} : { name }) };
  const listQuery = useQuery(
    {
      queryKey: queryKeys.artifacts.list(listParams),
      queryFn: () => artifactServer.listArtifacts(listParams),
      placeholderData: keepPreviousData,
    },
    queryClient,
  );
  const artifacts = listQuery.data?.data ?? [];
  const selectedIds = new Set(selected.map(artifact => artifact.id));

  const toggle = (artifact: Artifact) => {
    onChange(selectedIds.has(artifact.id) ? selected.filter(item => item.id !== artifact.id) : [...selected, artifact]);
  };

  return (
    <div data-slot="aui_artifact-picker" className="flex flex-col">
      <div className="p-2">
        <SearchInput query={searchInput} setQuery={setSearchInput} placeholder="Search artifacts" />
      </div>
      <div className="max-h-64 overflow-y-auto px-1 pb-1">
        {listQuery.isPending ? (
          <div className="flex flex-col gap-1 p-1" role="status" aria-label="Loading artifacts">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-sm" />
            ))}
          </div>
        ) : listQuery.error != null && artifacts.length === 0 ? (
          <p role="alert" className="text-text-secondary px-2 py-3 text-sm">
            {getErrorMessage(listQuery.error, "Couldn't load artifacts.")}
          </p>
        ) : artifacts.length === 0 ? (
          <p className="text-text-secondary px-2 py-3 text-sm">
            {name === '' ? 'No saved artifacts yet' : `No artifacts match "${name}"`}
          </p>
        ) : (
          <div role="listbox" aria-label="Created by me" aria-multiselectable>
            <div className="text-text-secondary px-2 pt-1 pb-1 text-xs">Created by me</div>
            {artifacts.map(artifact => {
              const isSelected = selectedIds.has(artifact.id);
              return (
                <button
                  key={artifact.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={auiSelectOptionClass()}
                  onClick={() => toggle(artifact)}
                >
                  <Icon
                    name={getAttachmentFileIconName(artifact.entryPoint ?? artifact.name)}
                    className="text-text-secondary size-4 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{artifact.name}</span>
                    <span className="text-text-secondary truncate text-xs">
                      You · {formatRelativeTime(artifact.updatedAt)}
                    </span>
                  </span>
                  <Icon
                    name="check"
                    className={cn('text-primary-button-bg size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="text-text-secondary text-xs">Only saved artifacts appear here</span>
        <button type="button" className="text-primary-button-bg text-sm font-medium hover:underline" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    ArtifactPicker: typeof ArtifactPicker;
  }
}
