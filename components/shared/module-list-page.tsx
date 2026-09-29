'use client';

import { useState, useMemo, ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, MoreHorizontal, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Pencil, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { downloadCsv, csvFileName, type CsvValue } from '@/lib/export/csv';

export interface SummaryCard {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: { value: string; positive: boolean };
  color?: 'primary' | 'success' | 'warning' | 'destructive' | 'info';
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  searchable?: boolean;
  searchText?: (row: T) => string[];
  exportValue?: (row: T) => CsvValue;
}

interface ModuleListPageProps<T> {
  title: string;
  description?: string;
  summaryCards?: SummaryCard[];
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  searchPlaceholder?: string;
  onCreate?: () => void;
  createLabel?: string;
  toolbarActions?: ReactNode;
  onExport?: () => void;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  emptyMessage?: string;
  emptyDescription?: string;
  pageSize?: number;
  statusKey?: string;
  statusValue?: (row: T) => string;
}

const colorClasses: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function ModuleListPage<T extends { id?: string }>({
  title,
  description,
  summaryCards = [],
  columns,
  data,
  loading = false,
  searchPlaceholder = 'Search...',
  onCreate,
  createLabel = 'Add New',
  toolbarActions,
  onExport,
  onRowClick,
  rowActions,
  onEdit,
  onDelete,
  emptyMessage = 'No records found.',
  emptyDescription = 'Get started by creating your first record.',
  pageSize = 10,
  statusKey,
  statusValue,
}: ModuleListPageProps<T>) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const searchKeys = useMemo(
    () => columns.filter((c) => c.searchable !== false).map((c) => c.key),
    [columns]
  );

  const searchTexts = useMemo(() => columns.filter((c) => c.searchText).map((c) => c.searchText as (row: T) => string[]), [columns]);

  const statusOptions = useMemo(() => {
    if (!statusKey && !statusValue) return [];
    const counts = new Map<string, number>();
    for (const row of data) {
      const v = (statusValue ? statusValue(row) : String((row as Record<string, unknown>)[statusKey || ''] ?? ''))
        .trim()
        .replace(/[\s_]+/g, ' ')
        .toLowerCase();
      if (!v) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, statusKey, statusValue]);

  const filtered = useMemo(() => {
    let result = data;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((row) => {
        const record = row as Record<string, unknown>;
        const hitsRaw = searchKeys.some((key) => {
          const val = record[key];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(q);
        });
        const hitsRendered = searchTexts.some((fn) =>
          fn(row).some((s) => s && s.toLowerCase().includes(q))
        );
        return hitsRaw || hitsRendered;
      });
    }
    if (statusFilter) {
      result = result.filter((row) => {
        const v = (statusValue ? statusValue(row) : String((row as Record<string, unknown>)[statusKey || ''] ?? ''))
          .trim()
          .replace(/[\s_]+/g, ' ')
          .toLowerCase();
        return v === statusFilter;
      });
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey];
        const bv = (b as Record<string, unknown>)[sortKey];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [data, search, searchKeys, searchTexts, sortKey, sortDir, statusFilter, statusKey, statusValue]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  const hasRowMenu = onEdit || onDelete;
  const showStatusFilter = statusOptions.length > 1 || (statusKey || statusValue ? statusOptions.length > 0 : false);

  const exportCell = (col: Column<T>, row: T): CsvValue => {
    if (col.exportValue) return col.exportValue(row);
    const raw = (row as Record<string, unknown>)[col.key];
    if (raw !== null && raw !== undefined && typeof raw !== 'object') return raw as CsvValue;
    if (col.searchText) return col.searchText(row).filter(Boolean).join(' ');
    return raw === null || raw === undefined ? '' : JSON.stringify(raw);
  };

  const handleExport = () => {
    if (onExport) {
      onExport();
      return;
    }
    const headers = columns.map((col) => col.label);
    const rows = filtered.map((row) => columns.map((col) => exportCell(col, row)));
    downloadCsv(csvFileName(title), headers, rows);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {(onExport || filtered.length > 0) && (
            <Button variant="outline" size="sm" onClick={handleExport} className="print:hidden">
              <Download className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}
          {toolbarActions && (
            <div className="flex items-center gap-2">{toolbarActions}</div>
          )}
          {onCreate && (
            <Button size="sm" onClick={onCreate}>
              <Plus className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{createLabel}</span>
              <span className="sm:hidden">Add</span>
            </Button>
          )}
        </div>
      </div>

      {summaryCards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', colorClasses[card.color || 'primary'])}>
                      <Icon className="h-5 w-5" />
                    </div>
                    {card.trend && (
                      <span
                        className={cn(
                          'text-xs font-medium',
                          card.trend.positive ? 'text-success' : 'text-destructive'
                        )}
                      >
                        {card.trend.value}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-2xl font-bold">{card.value}</p>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 border-b border-border p-4 print:hidden">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
            {showStatusFilter && (
              <Select
                value={statusFilter || '__all__'}
                onValueChange={(v) => { setStatusFilter(v === '__all__' ? null : v); setPage(0); }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  {statusOptions.map(([value, count]) => (
                    <SelectItem key={value} value={value}>
                      {value.replace(/^./, (c) => c.toUpperCase())} ({count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filtered.length !== data.length && (
              <span className="text-sm text-muted-foreground">
                {filtered.length} of {data.length} records
              </span>
            )}
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  {columns.map((col) => {
                    const sortable = col.sortable !== false;
                    return (
                      <TableHead key={col.key} className={col.className}>
                        {sortable ? (
                          <button
                            className="flex items-center gap-1 hover:text-foreground transition-colors"
                            onClick={() => toggleSort(col.key)}
                          >
                            {col.label}
                            {sortKey === col.key ? (
                              sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                            )}
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">{col.label}</div>
                        )}
                      </TableHead>
                    );
                  })}
                  {(rowActions || hasRowMenu) && <TableHead className="w-12 print:hidden" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {columns.map((col) => (
                        <TableCell key={col.key}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                      {(rowActions || hasRowMenu) && <TableCell className="print:hidden"><Skeleton className="h-5 w-8" /></TableCell>}
                    </TableRow>
                  ))
                ) : paged.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length + (rowActions || hasRowMenu ? 1 : 0)}
                      className="h-32"
                    >
                      <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                        <Inbox className="h-10 w-10 opacity-40" />
                        <p className="text-sm font-medium">{emptyMessage}</p>
                        <p className="text-xs">{emptyDescription}</p>
          {onCreate && (
                          <Button size="sm" variant="outline" className="mt-2" onClick={onCreate}>
                            <Plus className="mr-2 h-4 w-4" />
                            {createLabel}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map((row, idx) => (
                    <TableRow
                      key={row.id || idx}
                      className={onRowClick ? 'cursor-pointer hover:bg-accent/50' : ''}
                      onClick={() => onRowClick?.(row)}
                    >
                      {columns.map((col) => (
                        <TableCell key={col.key} className={col.className}>
                          {col.render
                            ? col.render(row)
                            : String((row as Record<string, unknown>)[col.key] ?? '')}
                        </TableCell>
                      ))}
                      {(rowActions || hasRowMenu) && (
                        <TableCell className="w-12 print:hidden" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {rowActions?.(row)}
                            {hasRowMenu && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {onEdit && (
                                    <DropdownMenuItem onClick={() => onEdit(row)}>
                                      <Pencil className="mr-2 h-4 w-4" /> Edit
                                    </DropdownMenuItem>
                                  )}
                                  {onDelete && (
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => setDeleteTarget(row)}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {!loading && totalPages > 1 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-border px-4 py-3 print:hidden">
              <span className="text-sm text-muted-foreground">
                Page {currentPage + 1} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The record will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget && onDelete) {
                  onDelete(deleteTarget);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}