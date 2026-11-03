// File and page expiries (docs/spec/vencimientos.md), in English. Same shape as es/expiries.ts.

import type { Catalog } from "../index";
import type { expiriesTexts as EsExpiries } from "../es/expiries";

export const expiriesTexts: Catalog<typeof EsExpiries> = {
  nav: "Expiries",
  menu: "Expiry",
  pendingCount: (count: number, expired: number) =>
    expired > 0
      ? `${String(count)} ${count === 1 ? "expiry of yours to handle" : "expiries of yours to handle"}, ${String(expired)} expired`
      : count === 1
        ? "1 expiry of yours due soon"
        : `${String(count)} expiries of yours due soon`,
  badge: {
    dueIn: (days: number) =>
      days === 0 ? "Due today" : days === 1 ? "Due in 1 day" : `Due in ${String(days)} days`,
    expiredAgo: (days: number) =>
      days === 1 ? "Expired 1 day ago" : `Expired ${String(days)} days ago`,
    dueOn: (date: string) => `Due ${date}`,
    open: "See the expiry",
  },
  states: { valid: "Valid", due_soon: "Due soon", expired: "Expired" },
  dialog: {
    title: (name: string) => `Expiry of “${name}”`,
    description:
      "Tells whoever is responsible in the bell and by email, at 8:00 company time, on the days you choose.",
    dueOn: "Expires on",
    responsible: "Responsible",
    responsiblePlaceholder: "You (whoever sets it)",
    responsibleHint: "If you choose no one, you're responsible: someone has to get the notices.",
    department: "Department · tells its heads and deputies",
    cantSee: "Can’t see this item: wouldn’t get the notices",
    cantSeeWarning: (name: string) =>
      `${name} can’t see this item, so they won’t get the notices (they’d give its name away): you will. Share it or choose someone else.`,
    noticeDays: "Notify",
    notice: (days: number) =>
      days === 0 ? "On the day" : days === 1 ? "1 day before" : `${String(days)} days before`,
    noticeHint: "If you choose none, it notifies only on the day.",
    note: "Note",
    notePlaceholder: "What needs doing (for example, renew with the supplier).",
    save: "Save",
    saved: "Expiry saved.",
    remove: "Remove the expiry",
    removed: "Expiry removed.",
    readOnly: "Only someone who can edit this item, or manages expiries, can change it.",
    none: "This item has no expiry.",
    loadError: "Couldn’t load the expiry.",
    invalidDate: "Choose the day it expires.",
    suggest: "Suggest with Bian",
    suggesting: "Bian is reading the document…",
    suggested:
      "Bian suggests this from the document. Review it and press Save: it isn’t saved on its own.",
    evidence: (text: string) => `From the document: “${text}”`,
    noDate:
      "Bian found no expiry date in the document. If it suggested a note or someone responsible, they’re already in the form.",
  },
  newVersion: {
    title: "Update the expiry?",
    text: (before: string, proposed: string) =>
      `This file expired on ${before}. With the new version, move it to ${proposed}? That’s the same term it had.`,
    update: "Update",
    other: "Choose another day",
    keep: "Leave it",
  },
  page: {
    title: "Expiries",
    subtitle:
      "Files and pages with an expiry date: only the ones you can see. Whoever is responsible gets the notices.",
    csv: "Export CSV",
    views: { list: "List", calendar: "Calendar" },
    filters: {
      space: "Space",
      anySpace: "All spaces",
      department: "Department",
      anyDepartment: "All",
      responsible: "Responsible",
      anyResponsible: "Anyone",
      status: "State",
      from: "From",
      to: "To",
    },
    statuses: { all: "All", valid: "Valid", due_soon: "Due soon", expired: "Expired" },
    columns: {
      dueOn: "Due",
      element: "Item",
      space: "Space",
      responsible: "Responsible",
      state: "State",
    },
    empty: "There are no expiries with these filters.",
    emptyText: "Set an expiry from the “⋯” menu of a file or a page, or from its screen.",
    calendar: {
      previous: "Previous month",
      next: "Next month",
      today: "Today",
      more: (count: number) => `and ${String(count)} more`,
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
  },
  home: {
    title: "Your expiries",
    subtitle: "What you or your department look after, due soon or expired.",
    seeAll: "See all",
    more: (count: number) => `and ${String(count)} more`,
  },
};
