// A contractor's worker's card (docs/spec/cae.md, «Fases» 3): name, company and the QR that opens the
// gatehouse with them (the code only carries the app's address; it needs signing in with cae.check).
// Printed from a window of its own with nothing else on it.
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { DialogContent } from "@/components/ui/overlay";
import { caeApi, caeKeys } from "./cae-api";
import { texts } from "@/i18n";

const t = texts.cae.card;

/** Prints the card in a window of its own (text set as text, never as HTML). */
function printCard(name: string, company: string, qr: string): void {
  const popup = window.open("", "_blank", "width=420,height=560");
  if (popup === null) return;
  const doc = popup.document;
  doc.title = t.title(name);
  const style = doc.createElement("style");
  style.textContent =
    "body{font-family:Helvetica,Arial,sans-serif;margin:24px}" +
    ".card{border:1px solid #999;border-radius:12px;padding:20px;width:300px;text-align:center}" +
    "h1{font-size:20px;margin:0 0 4px}p{margin:0 0 12px;color:#444}img{width:240px;height:240px}";
  doc.head.append(style);
  const card = doc.createElement("div");
  card.className = "card";
  const title = doc.createElement("h1");
  title.textContent = name;
  const subtitle = doc.createElement("p");
  subtitle.textContent = company;
  const image = doc.createElement("img");
  image.alt = t.alt(name);
  image.src = qr;
  card.append(title, subtitle, image);
  doc.body.append(card);
  image.addEventListener("load", () => {
    popup.focus();
    popup.print();
  });
}

export function WorkerCard({
  workerId,
  name,
  company,
}: {
  workerId: string;
  name: string;
  company: string;
}) {
  const { workspaceSlug = "" } = useParams();
  const qr = useQuery({
    queryKey: caeKeys.qr(workspaceSlug, workerId),
    queryFn: () => caeApi.workerQr(workspaceSlug, workerId),
  });
  return (
    <DialogContent
      title={t.title(name)}
      description={t.text}
      footer={
        <Button
          disabled={qr.data === undefined}
          onClick={() => {
            if (qr.data !== undefined) printCard(name, company, qr.data.qr);
          }}
        >
          <Printer className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {t.print}
        </Button>
      }
    >
      <div className="mx-auto grid w-full max-w-xs justify-items-center gap-1 rounded-2xl border border-border p-5 text-center">
        <p className="text-lg font-semibold">{name}</p>
        <p className="text-sm text-muted-foreground">{company}</p>
        {qr.data === undefined ? (
          <Skeleton className="mt-3 size-60" />
        ) : (
          <img src={qr.data.qr} alt={t.alt(name)} className="mt-3 size-60" />
        )}
      </div>
    </DialogContent>
  );
}
