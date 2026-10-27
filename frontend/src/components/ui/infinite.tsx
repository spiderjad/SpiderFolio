// Listas con scroll infinito (CLAUDE.md, sección 17): useInfiniteQuery con paginación por cursor,
// carga automática al llegar al final (IntersectionObserver) y un botón "Cargar más" accesible
// como respaldo. El contador "Mostrando N de M" queda fijo. Nunca hay Anterior/Siguiente.
import { keepPreviousData, useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { texts } from "@/i18n";

/** Respuesta de toda lista paginada por cursor. */
export interface CursorPage<T> {
  items: T[];
  total: number;
  /** Cursor opaco de la página siguiente; null si no hay más. */
  nextCursor: string | null;
}

/**
 * Lista infinita sobre un endpoint con cursor. La clave incluye los filtros y el orden: al
 * cambiarlos, la lista vuelve a empezar (los filtros viven en la URL).
 */
export function useInfiniteList<T>({
  queryKey,
  fetchPage,
  enabled = true,
}: {
  queryKey: QueryKey;
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<T>>;
  enabled?: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const total = query.data?.pages.at(-1)?.total ?? 0;
  return {
    query,
    items,
    total,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}

/**
 * Centinela del final de la lista: al entrar en pantalla pide la página siguiente. Si no hay
 * IntersectionObserver (o para quien no hace scroll), queda el botón "Cargar más".
 */
export function LoadMore({
  hasNextPage,
  isFetching,
  onLoadMore,
  root,
  className,
}: {
  hasNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  /** Contenedor con scroll (por defecto, la ventana). */
  root?: RefObject<Element | null>;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (
      !hasNextPage ||
      isFetching ||
      target === null ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { root: root?.current ?? null, rootMargin: "240px" },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetching, onLoadMore, root]);

  if (!hasNextPage && !isFetching) return null;
  return (
    <div ref={ref} className={cn("flex justify-center p-3", className)}>
      {isFetching ? (
        <span role="status" className="text-xs text-muted-foreground">
          {texts.common.loadingMore}
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={onLoadMore}>
          {texts.common.loadMore}
        </Button>
      )}
    </div>
  );
}

/** Contador fijo "Mostrando N de M". */
export function ShownCounter({
  shown,
  total,
  className,
}: {
  shown: number;
  total: number;
  className?: string;
}) {
  return (
    <p
      aria-live="polite"
      className={cn(
        "sticky bottom-0 border-t border-border bg-background px-4 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {texts.common.shownOf(shown, total)}
    </p>
  );
}

/** Desde cuántas filas una lista se virtualiza; con menos se dibujan todas. */
export const LIST_VIRTUALIZE_AFTER = 60;

/**
 * Lista (<ul>) con scroll infinito por cursor y virtualización de filas: con muchas filas solo se
 * dibujan las visibles (la altura de cada una se mide, así pueden variar). Debajo, el centinela
 * de carga automática, el botón "Cargar más" de respaldo y el contador "Mostrando N de M".
 */
export function InfiniteList<T>({
  items,
  getKey,
  renderItem,
  estimateHeight = 56,
  paging,
  label,
  maxHeightClass = "max-h-[60vh]",
  className,
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Alto estimado de una fila (px); se corrige al medirla. */
  estimateHeight?: number;
  paging: {
    total: number;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    onLoadMore: () => void;
  };
  label?: string;
  maxHeightClass?: string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = items.length > LIST_VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateHeight,
    overscan: 8,
    enabled: virtualize,
  });
  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = virtualize
    ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)
    : 0;
  return (
    <div className={className}>
      <div ref={scrollRef} className={cn("overflow-y-auto", maxHeightClass)}>
        <ul
          aria-label={label}
          className="divide-y divide-border"
          style={virtualize ? { paddingTop, paddingBottom } : undefined}
        >
          {virtualize
            ? virtualItems.map((virtual) => {
                const item = items[virtual.index];
                return item === undefined ? null : (
                  <li
                    key={getKey(item)}
                    data-index={virtual.index}
                    ref={virtualizer.measureElement}
                  >
                    {renderItem(item)}
                  </li>
                );
              })
            : items.map((item) => <li key={getKey(item)}>{renderItem(item)}</li>)}
        </ul>
        <LoadMore
          hasNextPage={paging.hasNextPage}
          isFetching={paging.isFetchingNextPage}
          onLoadMore={paging.onLoadMore}
          root={scrollRef}
        />
      </div>
      {items.length > 0 && <ShownCounter shown={items.length} total={paging.total} />}
    </div>
  );
}
