// Search texts: Ctrl+K palette and full-text results. Same shape as es/search.ts.

import type { Catalog } from "../index";
import type { searchTexts as EsSearch } from "../es/search";

export const searchTexts: Catalog<typeof EsSearch> = {
  button: "Search",
  buttonHint: "Search (Ctrl+K)",
  page: {
    title: "Search",
    subtitle: "In titles, codes, and the content of pages, PDFs and Word files.",
    placeholder: "Search for a word or phrase",
    hintTitle: "Type at least two letters",
    hint: "Accents don’t matter. Use quotes for an exact phrase, or a hyphen to exclude a word.",
    emptyTitle: (q: string) => `Nothing for “${q}”`,
    empty: "Try a different word. You only see what you have permission to view.",
    loadError: "Couldn’t search.",
    shown: (count: number, more: boolean) =>
      more ? `Showing ${String(count)} (there are more)` : `Showing ${String(count)}`,
  },
  palette: {
    title: "Search",
    placeholder: "Search for documents, folders, spaces or people…",
    pickSpace: "Which space? Search or choose one",
    back: "Back to search",
    searching: "Searching…",
    empty: (text: string) => `We didn’t find anything for “${text}”.`,
    noWritableSpaces: "There are no spaces where you can create pages.",
    newPage: "New page",
    inContent: (text: string) => `Search for “${text}” in content`,
    goTo: (label: string) => `Go to ${label}`,
    groups: {
      recent: "Recent",
      documents: "Documents",
      folders: "Folders",
      spaces: "Spaces",
      people: "People",
      actions: "Actions",
    },
    hintNavigate: "↑ ↓ to move",
    hintOpen: "Enter to open",
  },
};
