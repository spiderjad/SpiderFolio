// Combobox único de la app (simple y múltiple), sobre Radix Popover + cmdk (CLAUDE.md, sección 17).
// - Se abre como menú flotante con altura máxima y scroll: nunca empuja el contenido de un
//   diálogo. En pantallas angostas (≤ 639 px) se abre como hoja desde abajo.
// - Busca en el servidor mientras se escribe (espera de 250 ms), pide de a 20 resultados y trae
//   el resto al hacer scroll: nunca carga la lista completa. Una fuente (`ComboboxSource`) dice
//   cómo buscar y cómo traer las etiquetas de lo ya elegido (por id).
// - Múltiple: los elegidos son chips dentro del mismo campo, quitables con × o con Backspace.
// - Jerarquía: una opción con `depth` se indenta bajo su padre con una línea guía; una con `path`
//   (resultado de búsqueda) muestra la ruta completa ("Finanzas › Contabilidad").
// - Estados: cargando (esqueleto), sin resultados y error con reintentar. Teclado completo
//   (flechas, Enter, Esc) por cmdk.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Check, ChevronDown, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Badge, Skeleton } from "./display";
import { texts } from "@/i18n";

export interface ComboOption {
  id: string;
  label: string;
  /** Texto secundario, en una línea bajo el principal. */
  description?: string | undefined;
  disabled?: boolean | undefined;
  /** Nivel de jerarquía (0 = raíz): se indenta con una línea guía. */
  depth?: number | undefined;
  /** Ruta de ancestros más el propio nombre; se muestra en los resultados de una búsqueda. */
  path?: readonly string[] | undefined;
  /** Datos de la fuente que quien elige necesita (ej. el rol base de un rol). */
  meta?: Readonly<Record<string, string>> | undefined;
}

export interface OptionsPage {
  items: ComboOption[];
  /** Cursor de la página siguiente; null si no hay más. */
  nextCursor: string | null;
}

export interface ComboboxSource {
  /** Identifica la fuente en la caché (incluye el workspace). */
  key: readonly unknown[];
  /** Una página de resultados para el texto buscado (sin cursor = la primera). */
  search: (q: string, cursor: string | undefined, signal?: AbortSignal) => Promise<OptionsPage>;
  /** Etiquetas de ids ya elegidos. */
  byIds: (ids: string[]) => Promise<ComboOption[]>;
  /** Opciones fijas que van arriba cuando no se busca (ej. un grupo). */
  pinned?: ComboOption[];
}

/** Resultados que trae cada página: los primeros 20 y el resto al hacer scroll. */
export const COMBO_PAGE_SIZE = 20;
const DEBOUNCE_MS = 250;
/** Distancia al final de la lista (px) a la que se pide la página siguiente. */
const NEAR_END_PX = 96;

/**
 * Fuente para listas cerradas y chicas (estado, tipo de plaza…): filtra en el cliente porque la
 * lista es fija por definición. Toda lista que pueda crecer usa una fuente del servidor.
 */
export function useStaticSource(key: string, options: readonly ComboOption[]): ComboboxSource {
  return useMemo(
    () => ({
      key: ["static", key],
      search: (q) => {
        const needle = q.trim().toLowerCase();
        const items = options.filter((option) => option.label.toLowerCase().includes(needle));
        return Promise.resolve({ items, nextCursor: null });
      },
      byIds: (ids) => Promise.resolve(options.filter((option) => ids.includes(option.id))),
    }),
    [key, options],
  );
}

function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return debounced;
}

/** True en pantallas angostas: ahí el Combobox se abre como hoja desde abajo. */
function useIsNarrow(): boolean {
  const query = "(max-width: 639px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => {
      setNarrow(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  return narrow;
}

/** Resultados de la búsqueda, paginados: cada página nueva la pide al servidor. */
function useResults(source: ComboboxSource, text: string, enabled: boolean) {
  const q = useDebounced(text.trim());
  const query = useInfiniteQuery({
    queryKey: [...source.key, "search", q],
    queryFn: ({ pageParam, signal }) => source.search(q, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const pinned = q === "" ? (source.pinned ?? []) : [];
  const items = useMemo(() => {
    const seen = new Set<string>();
    const all = [...pinned, ...(query.data?.pages.flatMap((page) => page.items) ?? [])];
    return all.filter((option) => (seen.has(option.id) ? false : (seen.add(option.id), true)));
    // pinned depende de q y de la fuente
  }, [query.data, q, source.pinned]);
  // Mientras se escribe y todavía no llegó la búsqueda nueva, se muestran los resultados de antes.
  const waiting = text.trim() !== q || query.isFetching;
  return { items, query, waiting, searching: q !== "" };
}

/** Etiquetas de los ids elegidos: las que ya se conocen y, para el resto, las pide al servidor. */
function useLabels(source: ComboboxSource, ids: readonly string[], known: Map<string, string>) {
  const missing = ids.filter((id) => !known.has(id));
  const resolved = useQuery({
    queryKey: [...source.key, "ids", [...missing].sort().join(",")],
    queryFn: () => source.byIds(missing),
    enabled: missing.length > 0,
    staleTime: 60_000,
  });
  const labels = new Map(known);
  for (const option of resolved.data ?? []) labels.set(option.id, option.label);
  for (const option of source.pinned ?? []) labels.set(option.id, option.label);
  return labels;
}

// ─── Panel (búsqueda + lista), igual en el menú flotante y en la hoja ────────────────────

const GUIDE_STEP_PX = 16;

function OptionRow({ option, selected }: { option: ComboOption; selected: boolean }) {
  const depth = option.depth ?? 0;
  const path = option.path !== undefined && option.path.length > 1 ? option.path : undefined;
  return (
    <div className="relative flex items-start gap-2" style={{ paddingLeft: depth * GUIDE_STEP_PX }}>
      {depth > 0 && (
        // Línea guía: une al subdepartamento con su padre.
        <span
          aria-hidden="true"
          className="absolute inset-y-[-8px] w-px bg-border"
          style={{ left: (depth - 1) * GUIDE_STEP_PX + 6 }}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm leading-snug">
          {path === undefined ? (
            option.label
          ) : (
            <>
              <span className="text-muted-foreground">{path.slice(0, -1).join(" › ")} › </span>
              <span className="font-medium">{path.at(-1)}</span>
            </>
          )}
        </span>
        {option.description !== undefined && (
          <span className="block break-words text-xs text-muted-foreground">
            {option.description}
          </span>
        )}
      </span>
      {selected && (
        <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
      )}
    </div>
  );
}

function Panel({
  label,
  searchable,
  text,
  onText,
  results,
  selected,
  onPick,
  onBackspaceEmpty,
}: {
  label: string;
  searchable: boolean;
  text: string;
  onText: (value: string) => void;
  results: ReturnType<typeof useResults>;
  selected: ReadonlySet<string>;
  onPick: (option: ComboOption) => void;
  onBackspaceEmpty?: (() => void) | undefined;
}) {
  const t = texts.combobox;
  const { items, query, waiting } = results;
  const listRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // Scroll: al acercarse al final se pide la página siguiente.
  const loadMore = useCallback(() => {
    const list = listRef.current;
    if (list === null || !hasNextPage || isFetchingNextPage) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_END_PX) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  // Si la página no llena la lista (no hay scroll posible), se sigue pidiendo.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null && list.clientHeight > 0 && list.scrollHeight <= list.clientHeight) {
      loadMore();
    }
  }, [items.length, loadMore]);

  return (
    <Command
      shouldFilter={false}
      loop
      label={searchable ? t.searchIn(label) : label}
      className="flex min-h-0 flex-col"
    >
      {searchable && (
        <Command.Input
          value={text}
          onValueChange={onText}
          placeholder={t.search}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Backspace" && text === "") onBackspaceEmpty?.();
          }}
          className="h-10 w-full shrink-0 border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      )}
      <Command.List
        ref={listRef}
        label={label}
        onScroll={loadMore}
        // Dentro de un diálogo modal, la rueda y el toque se perderían: se deja que la lista
        // se desplace sola.
        onWheel={(event) => {
          event.stopPropagation();
        }}
        onTouchMove={(event) => {
          event.stopPropagation();
        }}
        className="max-h-72 overflow-y-auto overscroll-contain p-1"
      >
        {items.map((option) => (
          <Command.Item
            key={option.id}
            value={option.id}
            disabled={option.disabled === true}
            onSelect={() => {
              onPick(option);
            }}
            className="cursor-pointer select-none rounded-lg px-2 py-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[selected=true]:bg-muted"
          >
            <OptionRow option={option} selected={selected.has(option.id)} />
          </Command.Item>
        ))}
        {query.isError ? (
          <div className="flex items-center justify-between gap-2 px-2 py-2 text-sm">
            <span className="text-danger">{t.error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void query.refetch();
              }}
            >
              {texts.common.retry}
            </Button>
          </div>
        ) : waiting && items.length === 0 ? (
          <div className="grid gap-2 p-2" role="status" aria-label={t.loading}>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-4/5" />
            <Skeleton className="h-8 w-3/5" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground" role="status">
            {t.empty}
          </p>
        ) : isFetchingNextPage ? (
          <div className="p-2" role="status" aria-label={t.loading}>
            <Skeleton className="h-8 w-full" />
          </div>
        ) : hasNextPage ? (
          // Sin scroll posible (o con lectores de pantalla) queda el botón.
          <div className="p-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void fetchNextPage();
              }}
            >
              {t.more}
            </Button>
          </div>
        ) : null}
      </Command.List>
    </Command>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────────────────

interface CommonProps {
  source: ComboboxSource;
  /** Texto cuando no hay nada elegido. */
  placeholder: string;
  /** Nombre accesible del campo. */
  label: string;
  id?: string | undefined;
  disabled?: boolean;
  /** Con false no hay cuadro de búsqueda (listas cerradas y chicas). */
  searchable?: boolean;
  className?: string;
  /** Para barras de filtros: una sola línea de h-9; si el texto no entra se corta con «…» y se completa en un tooltip. */
  compact?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string | undefined;
}

export interface SingleComboboxProps extends CommonProps {
  multiple?: false;
  value: string | null;
  /** Etiqueta ya conocida del valor (evita pedirla al servidor). */
  valueLabel?: string | undefined;
  onChange: (option: ComboOption | null) => void;
  clearable?: boolean;
}

export interface MultiComboboxProps extends CommonProps {
  multiple: true;
  values: readonly string[];
  /** Etiquetas ya conocidas de los valores. */
  valueLabels?: ReadonlyMap<string, string>;
  onChange: (ids: string[], labels: Map<string, string>) => void;
}

export type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

const fieldClass =
  "flex min-h-9 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-left text-sm text-foreground focus-within:ring-2 focus-within:ring-ring/40 aria-invalid:border-danger has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";

export function Combobox(props: ComboboxProps) {
  const {
    source,
    placeholder,
    label,
    id,
    disabled = false,
    searchable = true,
    className,
    compact = false,
  } = props;
  const panelId = useId();
  const narrow = useIsNarrow();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const results = useResults(source, text, open);

  const multiple = props.multiple === true;
  const values = props.multiple === true ? props.values : props.value === null ? [] : [props.value];
  // Etiquetas vistas en esta sesión (las elegidas y las que se conocían de antes).
  const [seen, setSeen] = useState<Map<string, string>>(
    () =>
      new Map(
        props.multiple === true
          ? (props.valueLabels ?? [])
          : props.value !== null && props.valueLabel !== undefined
            ? [[props.value, props.valueLabel]]
            : [],
      ),
  );
  const known = useMemo(() => {
    const map = new Map(seen);
    if (props.multiple !== true && props.value !== null && props.valueLabel !== undefined) {
      map.set(props.value, props.valueLabel);
    }
    return map;
  }, [seen, props]);
  const labels = useLabels(source, values, known);

  const close = () => {
    setOpen(false);
    setText("");
  };
  const pick = (option: ComboOption) => {
    const next = new Map(seen).set(option.id, option.label);
    setSeen(next);
    if (props.multiple === true) {
      const ids = props.values.includes(option.id)
        ? props.values.filter((current) => current !== option.id)
        : [...props.values, option.id];
      props.onChange(ids, next);
    } else {
      props.onChange(option);
      close();
    }
  };
  const removeLast = () => {
    if (props.multiple === true && props.values.length > 0) {
      props.onChange(props.values.slice(0, -1), seen);
    }
  };

  const ariaProps = {
    "aria-invalid": props["aria-invalid"],
    "aria-describedby": props["aria-describedby"],
  };
  const selectedSet = useMemo(() => new Set(values), [values]);
  const singleLabel =
    props.multiple !== true && props.value !== null ? labels.get(props.value) : undefined;

  const panel: ReactNode = (
    <Panel
      label={label}
      searchable={searchable}
      text={text}
      onText={setText}
      results={results}
      selected={selectedSet}
      onPick={pick}
      onBackspaceEmpty={multiple ? removeLast : undefined}
    />
  );

  const trigger = (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      role="combobox"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? panelId : undefined}
      disabled={disabled}
      onClick={() => {
        if (open) close();
        else setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Backspace" && multiple) removeLast();
        else if (event.key === "ArrowDown" && !open) {
          event.preventDefault();
          setOpen(true);
        }
      }}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 bg-transparent text-left focus-visible:outline-none disabled:cursor-not-allowed",
        compact ? "h-full min-h-0" : "min-h-7",
        multiple && "min-w-24",
      )}
      {...ariaProps}
    >
      <span
        {...(compact && props.multiple !== true ? { title: singleLabel ?? placeholder } : {})}
        className={cn(
          "min-w-0 flex-1",
          compact ? "truncate" : "whitespace-normal break-words",
          !multiple && singleLabel === undefined && "text-muted-foreground",
          multiple && "text-muted-foreground",
        )}
      >
        {multiple
          ? values.length === 0
            ? placeholder
            : texts.combobox.add
          : (singleLabel ?? placeholder)}
      </span>
      <ChevronDown
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <PopoverPrimitive.Root
      open={open && !narrow}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <div className={cn(fieldClass, compact && "h-9 py-0", className)} {...ariaProps}>
          {props.multiple === true && values.length > 0 && (
            <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={label}>
              {values.map((valueId) => {
                const name = labels.get(valueId);
                return (
                  <li key={valueId}>
                    <Badge tone="primary" className="gap-1 py-1 pl-2 pr-1 text-[13px]">
                      <span className="break-words">{name ?? "…"}</span>
                      {!disabled && (
                        <button
                          type="button"
                          aria-label={texts.combobox.remove(name ?? "")}
                          onClick={() => {
                            props.onChange(
                              props.values.filter((current) => current !== valueId),
                              seen,
                            );
                          }}
                          className="rounded p-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                          <X className="size-3" strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {trigger}
          {props.multiple !== true &&
            props.clearable === true &&
            props.value !== null &&
            !disabled && (
              <button
                type="button"
                aria-label={texts.combobox.clear(label)}
                onClick={() => {
                  props.onChange(null);
                  setText("");
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
        </div>
      </PopoverPrimitive.Anchor>

      {/* Pantallas anchas: menú flotante junto al campo. */}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={panelId}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          className="motion-pop z-50 flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-56 origin-[var(--radix-popover-content-transform-origin)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-pop"
        >
          {panel}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>

      {/* Pantallas angostas: hoja desde abajo. */}
      <DialogPrimitive.Root
        open={open && narrow}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="motion-fade fixed inset-0 z-[60] bg-foreground/30" />
          <DialogPrimitive.Content
            id={panelId}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
            className="motion-pop fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-pop"
          >
            <DialogPrimitive.Title className="px-4 pb-1 pt-4 text-sm font-medium">
              {label}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {placeholder}
            </DialogPrimitive.Description>
            {panel}
            <div className="border-t border-border p-3">
              <DialogPrimitive.Close asChild>
                <Button variant="outline" className="w-full">
                  {multiple ? texts.combobox.done : texts.common.close}
                </Button>
              </DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </PopoverPrimitive.Root>
  );
}
