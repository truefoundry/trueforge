'use client';

import React from 'react';

import { Icon } from '../../icons/Icon.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { cn } from '../lib/cn.js';
import { PopoverSelect } from './PopoverSelect.js';

export const DEFAULT_TABLE_PAGE_SIZE = 10;
export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /** Extra classes on the horizontal scroll wrapper. */
  containerClassName?: string;
};

export function Table({ className, containerClassName, ...props }: TableProps) {
  return (
    <div className={cn('w-full overflow-x-auto', containerClassName)}>
      <table className={cn('w-full min-w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement>;

export function TableHeader({ className, ...props }: TableHeaderProps) {
  return <thead className={cn('bg-secondary-bg/60', className)} {...props} />;
}

export type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody className={cn(className)} {...props} />;
}

export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement>;

export function TableRow({ className, ...props }: TableRowProps) {
  return (
    <tr className={cn('border-b border-border last:border-b-0 hover:bg-ghost-button-hover/40', className)} {...props} />
  );
}

export type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement>;

export function TableHead({ className, ...props }: TableHeadProps) {
  return (
    <th
      className={cn(
        'text-text-secondary border-b border-border px-3 py-2.5 text-left text-xs font-semibold tracking-wide uppercase',
        className,
      )}
      {...props}
    />
  );
}

export type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement>;

export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cn('text-text-secondary px-3 py-3', className)} {...props} />;
}

export type TablePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
};

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = TABLE_PAGE_SIZE_OPTIONS,
  className,
}: TablePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const from = total === 0 ? 0 : safePage * pageSize + 1;
  const to = Math.min(total, (safePage + 1) * pageSize);
  const canPrev = safePage > 0;
  const canNext = safePage < pageCount - 1;

  const sizeOptions = pageSizeOptions.map(size => ({
    value: String(size),
    label: String(size),
  }));

  return (
    <div
      className={cn(
        'text-text-secondary flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm',
        className,
      )}
    >
      <p className="tabular-nums" aria-live="polite">
        {total === 0 ? 'Showing 0 of 0' : `Showing ${String(from)}–${String(to)} of ${String(total)}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap">Rows per page</span>
          <PopoverSelect
            aria-label="Rows per page"
            className="w-[4.5rem]"
            value={String(pageSize)}
            options={sizeOptions}
            onValueChange={value => {
              onPageSizeChange(Number(value));
            }}
          />
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={!canPrev}
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            onClick={() => onPageChange(safePage - 1)}
          >
            <Icon name="chevron-left" className="size-4" />
          </button>
          <span className="min-w-[4.5rem] text-center tabular-nums">
            {String(safePage + 1)} / {String(pageCount)}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={!canNext}
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            onClick={() => onPageChange(safePage + 1)}
          >
            <Icon name="chevron-right" className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cursor / token pagination when the API has no total count. */
export type TableTokenPaginationProps = {
  pageSize: number;
  rowCount: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
};

export function TableTokenPagination({
  pageSize,
  rowCount,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onPageSizeChange,
  pageSizeOptions = TABLE_PAGE_SIZE_OPTIONS,
  className,
}: TableTokenPaginationProps) {
  const sizeOptions = pageSizeOptions.map(size => ({
    value: String(size),
    label: String(size),
  }));

  return (
    <div
      className={cn(
        'text-text-secondary flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm',
        className,
      )}
    >
      <p className="tabular-nums" aria-live="polite">
        {rowCount === 0 ? 'Showing 0' : `Showing ${String(rowCount)}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap">Rows per page</span>
          <PopoverSelect
            aria-label="Rows per page"
            className="w-[4.5rem]"
            value={String(pageSize)}
            options={sizeOptions}
            onValueChange={value => {
              onPageSizeChange(Number(value));
            }}
          />
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={!canPrev}
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            onClick={onPrev}
          >
            <Icon name="chevron-left" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={!canNext}
            className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
            onClick={onNext}
          >
            <Icon name="chevron-right" className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
