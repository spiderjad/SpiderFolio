// "Share" texts (module 5), in English. Same shape as es/sharing.ts.

import type { Catalog } from "../index";
import type { sharingTexts as EsSharing } from "../es/sharing";

export const sharingTexts: Catalog<typeof EsSharing> = {
  open: "Share",
  title: (name: string) => `Share “${name}”`,
  description:
    "Give access to departments (recommended: when someone changes areas, their access changes automatically) or to individual people.",
  add: {
    title: "Give access",
    department: "Department",
    person: "Person",
    company: "Whole company",
    companyHint:
      "All active members of the company, excluding external guests. Readers can go up to Comment only.",
    pickDepartment: "Choose a department",
    pickPerson: "Choose a person",
    searchDepartment: "Search for a department",
    searchPerson: "Search for a person",
    level: "Level",
    expires: "Expires (optional)",
    submit: "Give access",
    submitting: "Giving access…",
    includeSubareas: "Include subareas",
    includeSubareasHint:
      "Members of subdepartments also get this access. If you leave it unchecked, only the chosen department gets it.",
    limitedHint: "Readers and external guests can’t edit or manage.",
    emailHint: "The person gets an email notification.",
  },
  levels: { VIEW: "View", COMMENT: "Comment", EDIT: "Edit", MANAGE: "Manage" },
  saved: "Access saved.",
  removed: "Access removed.",
  grants: {
    title: "Access given",
    empty: "No one has been given direct access here.",
    person: "Person",
    department: "Department",
    company: "All active members",
    expires: (date: string) => `Expires ${date}`,
    subareas: "Includes subareas",
    by: (name: string) => `Given by ${name}`,
    inheritedFrom: (name: string) => `Inherited from “${name}”`,
    remove: (name: string) => `Remove ${name}’s access`,
    level: (name: string) => `${name}’s level`,
  },
  people: {
    title: "Who can get in and why",
    search: "Search for a person",
    empty: "No one has access.",
    none: "No one matches your search.",
    truncated: "There are more than 5,000 people: showing the first ones. Use the search.",
    reasonsMore: (count: number) => `and ${String(count)} more reason${count === 1 ? "" : "s"}`,
  },
  reasons: {
    owner: "They’re the workspace owner.",
    admin: "They’re an admin: they manage all content.",
    bypass: "They have permission to manage all content.",
    leaderHead: (department: string) => `They’re head of ${department}.`,
    leaderDeputy: (department: string) => `They’re deputy of ${department}.`,
    member: (department: string) => `They’re part of ${department}.`,
    memberSubareas: (department: string) => `They’re part of ${department} (includes subareas).`,
    grantPerson: "They were given direct access.",
    grantCompany: "The whole company has access.",
    grantDepartment: (department: string) => `Their department ${department} has access.`,
    company: "It’s a space for the whole company.",
    visible: (department: string) => `It’s a visible ${department} space.`,
    expires: (date: string) => `Expires ${date}`,
    inheritedFrom: (name: string) => `Inherited from “${name}”`,
  },
  inheritance: {
    title: "Inheritance",
    inherits: (name: string) => `Inherits access from “${name}”.`,
    cut: (name: string) => `Doesn’t inherit from “${name}”: only access given here applies.`,
    cutAction: "Stop inheriting",
    restoreAction: "Restore inheritance",
    confirmCut: {
      title: "Stop inheriting?",
      text: "Only people given access here (plus the owner and admins) will have access. Anyone who currently gets in through the parent item loses access.",
      action: "Stop inheriting",
      pending: "Stopping…",
    },
    confirmRestore: {
      title: "Restore inheritance?",
      text: "Access given on the parent item will apply again, in addition to access given here.",
      action: "Restore",
      pending: "Restoring…",
    },
    cutDone: "Inheritance stopped.",
    restored: "Inheritance restored.",
    keptAccess:
      "Since you were going to lose access, we gave you direct “Manage” access. You can remove it anytime.",
  },
  mark: {
    with: (names: string[], extra: number) => {
      const list =
        names.length <= 1
          ? (names[0] ?? "")
          : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
      return extra > 0
        ? `Shared with ${names.join(", ")} and ${String(extra)} more`
        : `Shared with ${list}`;
    },
    expires: (date: string) => `expires ${date}`,
  },
  close: "Close",
  loadError: "Couldn’t load who has access.",
};
