// Tabla de datos (10.5) sobre TanStack Table 8: cabecera fija en mayúsculas espaciadas, filas de
// 56 px y estados vacío y de carga. Orden y paginación son del lado del servidor (manual): scroll
// infinito por cursor (carga al llegar al final, "Cargar más" de respaldo y "Mostrando N de M"
// fijo). Las listas largas se virtualizan con @tanstack/react-virtual.
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Checkbox } from "./form";
import { Skeleton } from "./display";
import { LoadMore, ShownCounter } from "./infinite";
import { texts } from "@/i18n";

export interface SortState {
  id: string;
  desc: boolean;
}

/** Altura fija de cada fila (px): permite virtualizar sin medir. */
export const ROW_HEIGHT = 56;
/** Desde cuántas filas se virtualiza; con menos se dibujan todas. */
export const VIRTUALIZE_AFTER = 60;

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  getRowId: (row: T) => string;
  /** Nombre accesible de la tabla. */
  label: string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Con selección, aparece la columna de casillas. */
  selection?: {
    selectedIds: ReadonlySet<string>;
    onChange: (ids: Set<string>) => void;
    /** Etiqueta de la casilla de cada fila. */
    rowLabel: (row: T) => string;
  };
  loading?: boolean;
  skeletonRows?: number;
  /** Se muestra en lugar de las filas cuando no hay datos. */
  empty?: ReactNode;
  /** Scroll infinito por cursor: total de la lista y cómo pedir la página siguiente. */
  paging?: {
    total: number;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    onLoadMore: () => void;
  };
  /** Alto máximo del área con scroll (la cabecera queda fija arriba). */
  maxHeightClass?: string;
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  label,
  sort,
  onSortChange,
  selection,
  loading = false,
  skeletonRows = 6,
  empty,
  paging,
  maxHeightClass = "max-h-[70vh]",
}: DataTableProps<T>) {
  const rowSelection: RowSelectionState = Object.fromEntries(
    [...(selection?.selectedIds ?? [])].map((id) => [id, true]),
  );
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: selection !== undefined,
    state: { rowSelection },
    onRowSelectionChange: (updater) => {
      if (selection === undefined) return;
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      selection.onChange(new Set(Object.keys(next).filter((id) => next[id] === true)));
    },
  });
  const columnCount = columns.length + (selection === undefined ? 0 : 1);
  const rows = table.getRowModel().rows;
  const allSelected = rows.length > 0 && rows.every((row) => row.getIsSelected());
  const someSelected = rows.some((row) => row.getIsSelected());
  const headerBox = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = rows.length > VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    enabled: virtualize,
  });
  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const visibleRows = virtualize ? virtualItems.flatMap((item) => rows[item.index] ?? []) : rows;
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = virtualize
    ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)
    : 0;
  useEffect(() => {
    if (headerBox.current !== null) headerBox.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    <div>
      <div ref={scrollRef} className={cn("relative overflow-auto", maxHeightClass)}>
        <table
          className="w-full min-w-[720px] border-collapse text-left text-sm"
          aria-label={label}
        >
          <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr className="border-b border-border">
              {selection !== undefined && (
                <th scope="col" className="w-12 px-4 py-3">
                  <Checkbox
                    ref={headerBox}
                    aria-label={texts.admin.members.selectAll}
                    checked={allSelected}
                    onChange={(event) => {
                      table.toggleAllRowsSelected(event.target.checked);
                    }}
                  />
                </th>
              )}
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const sortable =
                  onSortChange !== undefined && header.column.columnDef.enableSorting === true;
                const active = sort?.id === header.column.id;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
                    className="px-4 py-2.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-[0.12em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        onClick={() => {
                          onSortChange({ id: header.column.id, desc: active ? !sort.desc : false });
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {active ? (
                          sort.desc ? (
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden="true" style={{ height: paddingTop }}>
                <td colSpan={columnCount} />
              </tr>
            )}
            {loading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i} className="h-12 border-b border-border last:border-0">
                    <td colSpan={columnCount} className="px-4">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              : visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    data-selected={row.getIsSelected() || undefined}
                    className={cn(
                      "h-12 border-b border-border last:border-0 hover:bg-muted/40",
                      row.getIsSelected() && "bg-primary-soft/50",
                    )}
                  >
                    {selection !== undefined && (
                      <td className="w-12 px-4">
                        <Checkbox
                          aria-label={selection.rowLabel(row.original)}
                          checked={row.getIsSelected()}
                          onChange={row.getToggleSelectedHandler()}
                        />
                      </td>
                    )}
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
            {paddingBottom > 0 && (
              <tr aria-hidden="true" style={{ height: paddingBottom }}>
                <td colSpan={columnCount} />
              </tr>
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && empty !== undefined && (
          <div className="py-10">{empty}</div>
        )}
        {paging !== undefined && (
          <LoadMore
            hasNextPage={paging.hasNextPage}
            isFetching={paging.isFetchingNextPage}
            onLoadMore={paging.onLoadMore}
            root={scrollRef}
          />
        )}
      </div>
      {paging !== undefined && !loading && rows.length > 0 && (
        <ShownCounter shown={rows.length} total={paging.total} />
      )}
    </div>
  );
}
