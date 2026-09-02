// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_PAGE_SIZE,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
} from '@/atoms/primitives/Table.js';

function PaginatedDemo({ rows }: { rows: string[] }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map(name => (
            <TableRow key={name}>
              <TableCell>{name}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={rows.length}
        onPageChange={setPage}
        onPageSizeChange={size => {
          setPageSize(size);
          setPage(0);
        }}
      />
    </div>
  );
}

describe('Table', () => {
  it('does not force narrow tables to desktop width', () => {
    render(
      <Table aria-label="Compact table">
        <TableBody />
      </Table>,
    );

    const table = screen.getByRole('table', { name: 'Compact table' });
    expect(table).toHaveClass('min-w-full');
    expect(table).not.toHaveClass('min-w-[48rem]');
  });

  it('renders header and body cells', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>alpha</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'alpha' })).toBeInTheDocument();
  });

  it('paginates rows and changes page size', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `row-${String(i + 1)}`);
    render(<PaginatedDemo rows={rows} />);

    expect(screen.getByText('Showing 1–10 of 12')).toBeInTheDocument();
    expect(screen.getByText('row-1')).toBeInTheDocument();
    expect(screen.getByText('row-10')).toBeInTheDocument();
    expect(screen.queryByText('row-11')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Showing 11–12 of 12')).toBeInTheDocument();
    expect(screen.getByText('row-11')).toBeInTheDocument();
    expect(screen.queryByText('row-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rows per page' }));
    fireEvent.click(screen.getByRole('option', { name: '25' }));
    expect(screen.getByText('Showing 1–12 of 12')).toBeInTheDocument();
    expect(screen.getByText('row-1')).toBeInTheDocument();
    expect(screen.getByText('row-12')).toBeInTheDocument();
  });
});
