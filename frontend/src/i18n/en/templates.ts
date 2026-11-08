// Company templates (docs/spec/plantillas.md).
import type { templatesTexts as es } from "../es/templates";
import type { Catalog } from "..";

export const templatesTexts: Catalog<typeof es> = {
  title: "Templates",
  subtitle:
    "The company's templates and the industry packs. A template is a fixed copy: if the original changes, it doesn't.",
  tabs: { mine: "Company", packs: "Industry packs" },
  kinds: { PAGE: "Page", FOLDER: "Folder" },
  allKinds: "Pages and folders",
  allCategories: "All categories",
  search: "Search templates",
  count: (nodes: number) => (nodes === 1 ? "1 item" : `${String(nodes)} items`),
  skipped: (files: number) =>
    files === 1 ? "1 file not included" : `${String(files)} files not included`,
  fromPack: "From a pack",
  by: (name: string) => `Saved by ${name}`,
  empty: {
    title: "No templates yet",
    text: "Save a page or a folder as a template from its «⋯» menu, or install an industry pack.",
  },
  noResults: "No template matches the search.",
  edit: "Edit",
  delete: "Delete",
  deleteTitle: (name: string) => `Delete the template «${name}»?`,
  deleteText:
    "What was already created with it doesn't change. Its images are deleted and free up space.",
  deleted: "Template deleted.",
  saved: "Template saved.",
  saving: "Saving…",
  creating: "Creating…",
  installing: "Installing…",
  deleting: "Deleting…",
  fields: {
    name: "Name",
    description: "Description",
    descriptionHint: "What it's for and when to use it.",
    category: "Category",
    categoryHint: "Optional. For example: Quality, Production, People.",
  },
  save: {
    action: "Save as template",
    title: "Save as template",
    page: "The page's current text is saved with its subpages and images.",
    folder: "The folders and pages you can see are saved. Files and forms aren't included.",
    noComments: "Comments, mentions and permissions aren't copied.",
    submit: "Save template",
    done: (name: string) => `Template «${name}» saved.`,
    skipped: (files: number) =>
      files === 1
        ? "1 file of the folder wasn't included."
        : `${String(files)} files of the folder weren't included.`,
  },
  use: {
    action: "From a company template",
    title: "Create from a template",
    text: "It's created here with this folder's permissions. Controlled documents start as drafts with a new code.",
    preview: "Contents",
    controlled: "Controlled document",
    submit: "Create",
    created: (name: string) => `«${name}» created from the template.`,
    controlledSkipped: (n: number) =>
      n === 1
        ? "1 controlled document was created as a plain page: you can't manage documents here."
        : `${String(n)} controlled documents were created as plain pages: you can't manage documents here.`,
    pick: "Pick a template",
    none: "The company has no templates yet.",
    invalid: "This template is damaged and can't be used.",
  },
  packs: {
    intro:
      "Ready-made sets to start with: folders, model pages and document types. They're guidance: adapt them to your company.",
    none: "There are no packs available.",
    folders: (n: number) => (n === 1 ? "1 folder" : `${String(n)} folders`),
    pages: (n: number) => (n === 1 ? "1 page" : `${String(n)} pages`),
    controlled: (n: number) =>
      n === 1 ? "1 controlled document" : `${String(n)} controlled documents`,
    templates: (n: number) => (n === 1 ? "1 template" : `${String(n)} templates`),
    installedAt: (date: string) => `Installed on ${date}`,
    install: "Install",
    installTitle: (name: string) => `Install «${name}»`,
    space: "Space",
    spaceHint: "A folder with the pack is created at the root of the space.",
    types: "Document types",
    typeNew: "will be added",
    typeExists: "already exists",
    typesNoPermission:
      "Missing types aren't added: you need to be able to set up the company. Those pages are created as plain pages.",
    departments: "Suggested departments",
    departmentsHint: "Tick the ones you want to create. None is created unless ticked.",
    departmentExists: "already exists",
    departmentsNoPermission: "Creating departments needs permission to manage them.",
    again:
      "This pack was already installed. If you go on, another copy of its folders is created; its templates aren't repeated.",
    submit: "Install pack",
    done: (name: string) => `Pack «${name}» installed.`,
    open: "Open",
  },
};
