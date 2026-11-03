// An element's screen (a page, a form): its expiry badge, the «Vencimiento» menu item and the dialog
// (docs/spec/vencimientos.md).
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/overlay";
import { ExpiryBadge, ExpiryDialog, useNodeExpiry } from "./expiry-dialog";
import { texts } from "@/i18n";

export function useExpiryControl(node: { id: string; name: string; type: string }) {
  const [open, setOpen] = useState(false);
  const current = useNodeExpiry(node.id);
  const expiry = current.data?.expiry ?? null;
  const show = () => {
    setOpen(true);
  };
  return {
    badge:
      expiry === null ? null : (
        <ExpiryBadge dueOn={expiry.dueOn} state={expiry.state} onClick={show} />
      ),
    menuItem: (
      <DropdownMenuItem onSelect={show}>
        <CalendarClock aria-hidden="true" />
        {texts.expiries.menu}
      </DropdownMenuItem>
    ),
    button: (
      <Button variant="outline" onClick={show}>
        <CalendarClock className="size-4" aria-hidden="true" />
        {texts.expiries.menu}
      </Button>
    ),
    dialog: (
      <ExpiryDialog
        target={open ? node : null}
        onClose={() => {
          setOpen(false);
        }}
      />
    ),
  };
}
