// Every Administration screen: on top, for the owner, «There's a new version of SpiderFolio» when the
// server knows of one (it asks GitHub once a day; UPDATE_CHECK=false turns it off). Closing it hides
// it until the next version (remembered in this browser only, lib/sidebar.ts).
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, X } from "lucide-react";
import { useState } from "react";
import { Outlet, useParams } from "react-router";
import { Banner } from "@/components/ui/display";
import { useMembership } from "@/features/home/workspace-layout";
import { api } from "@/lib/api";
import { readDismissedUpdate, saveDismissedUpdate } from "@/lib/sidebar";
import { updateGuideUrl } from "@/lib/web-url";
import { locale, texts } from "@/i18n";

interface UpdateNotice {
  current: string;
  latest: string;
  notesUrl: string;
}

function UpdateBanner() {
  const t = texts.admin.update;
  const { workspaceSlug = "" } = useParams();
  const [dismissed, setDismissed] = useState(readDismissedUpdate);
  const update = useQuery({
    queryKey: ["w", workspaceSlug, "admin", "updates"],
    queryFn: () => api<{ update: UpdateNotice | null }>(`/w/${workspaceSlug}/admin/updates`),
    select: (data) => data.update,
    staleTime: 3_600_000,
    retry: false,
  });
  const notice = update.data;
  if (notice === undefined || notice === null || dismissed === notice.latest) return null;
  return (
    <div className="mx-auto mb-4 w-full max-w-5xl">
      <Banner
        tone="info"
        icon={ArrowUpCircle}
        action={
          <button
            type="button"
            className="rounded p-1 text-primary-soft-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={t.dismiss}
            onClick={() => {
              saveDismissedUpdate(notice.latest);
              setDismissed(notice.latest);
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        }
      >
        {t.text(notice.latest, notice.current)}{" "}
        <a
          href={notice.notesUrl}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-4"
        >
          {t.notes}
        </a>
        {" · "}
        <a
          href={updateGuideUrl(locale)}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-4"
        >
          {t.howTo}
        </a>
      </Banner>
    </div>
  );
}

export function AdminLayout() {
  const membership = useMembership();
  return (
    <>
      {membership.role.base === "OWNER" && <UpdateBanner />}
      <Outlet />
    </>
  );
}
