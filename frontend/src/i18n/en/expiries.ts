// File and page expiries (docs/spec/vencimientos.md), in English. Same shape as es/expiries.ts.

import type { Catalog } from "../index";
import type { expiriesTexts as EsExpiries } from "../es/expiries";

export const expiriesTexts: Catalog<typeof EsExpiries> = {
  nav: "Expiries",
  menu: "Expiry",
  pendingCount: (count: number) =>
    count === 1 ? "1 expiry of yours to handle" : `${String(count)} expiries of yours to handle`,
  badge: {
    dueSoon: (date: string) => `Due ${date}`,
    expired: (date: string) => `Expired ${date}`,
    open: "See the expiry",
  },
  states: { valid: "Valid", due_soon: "Due soon", expired: "Expired" },
  dialog: {
    title: (name: string) => `Expiry of “${name}”`,
    description:
      "Tells whoever is responsible in the bell and by email, at 8:00 company time, on the days you choose.",
    dueOn: "Expires on",
    responsible: "Responsible",
    responsiblePlaceholder: "No one",
    department: "Department · tells its heads and deputies",
    cantSee: "Can’t see this item",
    cantSeeWarning: (name: string) =>
      `${name} can’t see this item: they’ll get the notices but won’t be able to open it. Share it with them or choose someone else.`,
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
