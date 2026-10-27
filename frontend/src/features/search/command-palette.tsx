// Paleta Ctrl+K (⌘K): busca por título y por código de documento, y ofrece ir a las secciones o crear
// una página. Con el campo vacío muestra los documentos recientes. Lo que devuelve el servidor ya
// está filtrado por lo que la persona ve; el teclado completo lo da cmdk (flechas, Enter, Esc).
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  ArrowLeft,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Layers,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { navItems } from "@/components/nav-items";
import type { Membership } from "@/auth/types";
import { documentsApi } from "@/features/documents/documents-api";
import { cn } from "@/lib/utils";
import { searchApi, searchKeys, type QuickNodeHit } from "./search-api";
import { texts } from "@/i18n";

const DEBOUNCE_MS = 180;

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value]);
  return debounced;
}

const norm = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function pathOf(slug: string, hit: Pick<QuickNodeHit, "id" | "type" | "spaceId" | "parentId">) {
  const base = `/app/${slug}/files/${hit.spaceId}`;
  if (hit.type === "PAGE") return `${base}/p/${hit.id}`;
  if (hit.type === "FOLDER") return `${base}/f/${hit.id}`;
  // Un archivo se ve en su carpeta.
  return hit.parentId === null ? base : `${base}/f/${hit.parentId}`;
}

function NodeIcon({ type }: { type: QuickNodeHit["type"] }) {
  const Icon = type === "PAGE" ? FileText : type === "FOLDER" ? Folder : File;
  return <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />;
}

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground aria-selected:bg-primary-soft aria-selected:text-primary-soft-foreground";
const headingClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground";

export function CommandPalette({
  open,
  onOpenChange,
  slug,
  membership,
  startPicking = false,
  onAskBian,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre directo en «elegir espacio» para una página nueva. */
  startPicking?: boolean;
  slug: string;
  membership: Membership;
  /** «Pregúntale a Bian» (con el texto escrito, si hay). */
  onAskBian: (question: string) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="motion-fade fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="motion-pop fixed left-1/2 top-[10dvh] z-50 flex max-h-[min(560px,80dvh)] w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-pop focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {texts.search.palette.title}
          </DialogPrimitive.Title>
          {open && (
            <PaletteBody
              slug={slug}
              membership={membership}
              startPicking={startPicking}
              onAskBian={onAskBian}
              onClose={() => {
                onOpenChange(false);
              }}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({
  slug,
  membership,
  startPicking,
  onAskBian,
  onClose,
}: {
  slug: string;
  membership: Membership;
  startPicking: boolean;
  onAskBian: (question: string) => void;
  onClose: () => void;
}) {
  const t = texts.search.palette;
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(startPicking);
  const q = useDebounced(text.trim());
  const go = (to: string) => {
    onClose();
    void navigate(to);
  };
  const quick = useQuery({
    queryKey: searchKeys.quick(slug, q, picking ? "writable" : undefined),
    queryFn: ({ signal }) => searchApi.quick(slug, q, picking ? "writable" : undefined, signal),
    enabled: picking || q.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const recent = useQuery({
    queryKey: ["w", slug, "search", "recent"],
    queryFn: () => documentsApi.recent(slug, 6),
    enabled: !picking && text.trim() === "",
    staleTime: 30_000,
  });
  // Las personas se buscan en Miembros si la persona lo ve; si no, en Departamentos (el directorio).
  const peopleBase =
    navItems(slug, membership).find((item) => item.to.endsWith("/admin/members"))?.to ??
    `/app/${slug}/admin/departments`;
  const needle = norm(text.trim());
  const nav = navItems(slug, membership).filter(
    (item) => needle === "" || norm(item.label).includes(needle),
  );
  const showNewPage = needle === "" || norm(t.newPage).includes(needle);
  const data = quick.data;
  const searching = text.trim() !== "" && (quick.isFetching || q !== text.trim());
  const nothing =
    !picking &&
    q.length > 0 &&
    q === text.trim() &&
    !quick.isFetching &&
    data !== undefined &&
    data.documents.length + data.folders.length + data.spaces.length + data.people.length === 0 &&
    nav.length === 0;

  const group = (heading: string, children: ReactNode) => (
    <Command.Group heading={heading} className={headingClass}>
      {children}
    </Command.Group>
  );

  return (
    <Command shouldFilter={false} loop label={t.title} className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3">
        {picking ? (
          <button
            type="button"
            aria-label={t.back}
            onClick={() => {
              setPicking(false);
              setText("");
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : (
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}
        <Command.Input
          value={text}
          onValueChange={setText}
          placeholder={picking ? t.pickSpace : t.placeholder}
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:block">
          Esc
        </kbd>
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
        {nothing && (
          <Command.Empty className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t.empty(text.trim())}
          </Command.Empty>
        )}
        {searching && !nothing && data === undefined && (
          <div role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t.searching}
          </div>
        )}

        {picking ? (
          <>
            {data !== undefined && data.spaces.length === 0 && !quick.isFetching && (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                {t.noWritableSpaces}
              </div>
            )}
            {data !== undefined &&
              data.spaces.length > 0 &&
              group(
                t.groups.spaces,
                data.spaces.map((space) => (
                  <Command.Item
                    key={space.id}
                    value={`space-${space.id}`}
                    onSelect={() => {
                      go(`/app/${slug}/files/${space.id}?nueva=pagina`);
                    }}
                    className={itemClass}
                  >
                    <span className="grid size-5 place-items-center text-base leading-none">
                      {space.icon ?? <Layers className="size-4" strokeWidth={1.75} />}
                    </span>
                    <span className="truncate">{space.name}</span>
                  </Command.Item>
                )),
              )}
          </>
        ) : (
          <>
            <Command.Item
              value="action-bian"
              onSelect={() => {
                onAskBian(text.trim());
              }}
              className={itemClass}
            >
              <Sparkles
                className="size-4 shrink-0 text-primary"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="truncate">
                {text.trim().length >= 3
                  ? texts.bian.paletteWithText(text.trim())
                  : texts.bian.paletteAction}
              </span>
            </Command.Item>
            {text.trim() === "" &&
              recent.data !== undefined &&
              recent.data.items.length > 0 &&
              group(
                t.groups.recent,
                recent.data.items.map((item) => (
                  <Command.Item
                    key={item.node.id}
                    value={`recent-${item.node.id}`}
                    onSelect={() => {
                      go(
                        pathOf(slug, {
                          id: item.node.id,
                          type: item.node.type,
                          spaceId: item.node.spaceId,
                          parentId: null,
                        }),
                      );
                    }}
                    className={itemClass}
                  >
                    <NodeIcon type={item.node.type} />
                    <span className="min-w-0 flex-1 truncate">{item.node.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.code ?? item.node.spaceName}
                    </span>
                  </Command.Item>
                )),
              )}
            {text.trim().length >= 2 && (
              <Command.Item
                value="action-fulltext"
                onSelect={() => {
                  go(`/app/${slug}/search?q=${encodeURIComponent(text.trim())}`);
                }}
                className={itemClass}
              >
                <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate">{t.inContent(text.trim())}</span>
              </Command.Item>
            )}
            {data !== undefined &&
              q.length > 0 &&
              data.documents.length > 0 &&
              group(
                t.groups.documents,
                data.documents.map((hit) => (
                  <Command.Item
                    key={hit.id}
                    value={`doc-${hit.id}`}
                    onSelect={() => {
                      go(pathOf(slug, hit));
                    }}
                    className={itemClass}
                  >
                    <NodeIcon type={hit.type} />
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    {hit.code !== null && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                        {hit.code}
                      </span>
                    )}
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {hit.spaceName}
                    </span>
                  </Command.Item>
                )),
              )}
            {data !== undefined &&
              q.length > 0 &&
              data.folders.length > 0 &&
              group(
                t.groups.folders,
                data.folders.map((hit) => (
                  <Command.Item
                    key={hit.id}
                    value={`folder-${hit.id}`}
                    onSelect={() => {
                      go(pathOf(slug, hit));
                    }}
                    className={itemClass}
                  >
                    <NodeIcon type="FOLDER" />
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {hit.spaceName}
                    </span>
                  </Command.Item>
                )),
              )}
            {data !== undefined &&
              q.length > 0 &&
              data.spaces.length > 0 &&
              group(
                t.groups.spaces,
                data.spaces.map((space) => (
                  <Command.Item
                    key={space.id}
                    value={`space-${space.id}`}
                    onSelect={() => {
                      go(`/app/${slug}/files/${space.id}`);
                    }}
                    className={itemClass}
                  >
                    <span className="grid size-5 place-items-center text-base leading-none">
                      {space.icon ?? <FolderOpen className="size-4" strokeWidth={1.75} />}
                    </span>
                    <span className="truncate">{space.name}</span>
                  </Command.Item>
                )),
              )}
            {data !== undefined &&
              q.length > 0 &&
              data.people.length > 0 &&
              group(
                t.groups.people,
                data.people.map((person) => (
                  <Command.Item
                    key={person.id}
                    value={`person-${person.id}`}
                    onSelect={() => {
                      go(`${peopleBase}?q=${encodeURIComponent(person.name)}`);
                    }}
                    className={itemClass}
                  >
                    <User className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{person.name}</span>
                    <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block">
                      {[person.jobTitle, ...person.departments.slice(0, 1)]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </span>
                  </Command.Item>
                )),
              )}
            {(showNewPage || nav.length > 0) &&
              group(
                t.groups.actions,
                <>
                  {showNewPage && (
                    <Command.Item
                      value="action-new-page"
                      onSelect={() => {
                        setPicking(true);
                        setText("");
                      }}
                      className={itemClass}
                    >
                      <FilePlus2
                        className="size-4 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>{t.newPage}</span>
                    </Command.Item>
                  )}
                  {nav.map((item) => (
                    <Command.Item
                      key={item.to}
                      value={`nav-${item.to}`}
                      onSelect={() => {
                        go(item.to);
                      }}
                      className={itemClass}
                    >
                      <item.icon
                        className="size-4 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span>{t.goTo(item.label)}</span>
                    </Command.Item>
                  ))}
                </>,
              )}
          </>
        )}
      </Command.List>
      <div
        className={cn(
          "hidden items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex",
        )}
      >
        <span>{t.hintNavigate}</span>
        <span>{t.hintOpen}</span>
      </div>
    </Command>
  );
}
