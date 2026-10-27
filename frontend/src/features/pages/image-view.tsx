// Imagen dentro del editor: el documento guarda solo su `imageId`; la dirección de lectura se pide
// al servidor (con los permisos de la página) y dura un minuto.
import { PageImage } from "@spiderfolio/content";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { Skeleton } from "@/components/ui/display";
import { pagesApi } from "@/features/files/api";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

interface Options {
  slug: string;
  pageId: string;
}

function ImageView({ node, selected, extension, editor, updateAttributes }: NodeViewProps) {
  const { slug, pageId } = extension.options as Options;
  const imageId = typeof node.attrs.imageId === "string" ? node.attrs.imageId : "";
  const image = useQuery({
    queryKey: ["w", slug, "pages", pageId, "image", imageId],
    queryFn: () => pagesApi.imageUrl(slug, pageId, imageId),
    enabled: imageId !== "",
    staleTime: 45_000,
    retry: 1,
  });
  return (
    <NodeViewWrapper className="my-4" data-drag-handle>
      {image.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : image.isError ? (
        <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          <ImageOff className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {texts.pages.image.unavailable}
        </div>
      ) : (
        <img
          src={image.data.url}
          alt={typeof node.attrs.alt === "string" ? node.attrs.alt : ""}
          className={cn(
            "mx-auto max-h-[560px] max-w-full rounded-lg border border-border",
            selected && "ring-2 ring-primary",
          )}
        />
      )}
      {selected && editor.isEditable && (
        <input
          value={typeof node.attrs.alt === "string" ? node.attrs.alt : ""}
          maxLength={200}
          aria-label={texts.pages.image.altLabel}
          placeholder={texts.pages.image.altPlaceholder}
          onChange={(event) => {
            updateAttributes({ alt: event.target.value });
          }}
          className="mx-auto mt-2 block h-9 w-full max-w-md rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      )}
    </NodeViewWrapper>
  );
}

/** La imagen del schema, con su vista de React (necesita el workspace y la página para leerse). */
export const PageImageView = PageImage.extend({
  addOptions() {
    return { slug: "", pageId: "" };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
