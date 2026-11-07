// General texts of the public website in English: navigation, home, FAQ, footer and docs.
import { SITE } from "../../config/site.ts";
import type { site as esSite } from "../es/site.ts";
import type { Catalog } from "../types.ts";

export const site: Catalog<typeof esSite> = {
  nav: {
    features: "Features",
    install: "Install",
    plugins: "Plugins",
    docs: "Docs",
    faq: "FAQ",
  },
  a11y: {
    mainNav: "Main",
    mobileNav: "Mobile",
    language: "Language",
    currentLanguage: "Current language",
  },
  cta: { install: "Install", github: "View on GitHub", docs: "Read the docs" },
  theme: { toggle: "Toggle theme", menu: "Open menu", close: "Close menu" },
  /** Code block button (src/scripts/code-copy.ts). */
  code: { copy: "Copy", copied: "Copied ✓" },
  home: {
    eyebrow: "Open source · Documentation and health & safety for small businesses",
    title: "Your company's documentation, finally in order.",
    subtitle:
      "Pages, files and controlled documents with permissions anyone can understand, and occupational health and safety with its contractors, on your own server. Each department goes to its own space and everyone sees exactly what they should.",
    installNote: "Free and open source (AGPLv3). Installs with Docker in an afternoon.",
    mock: {
      path: "/Procedures/Document control",
      status: "Controlled document · Current version",
      rows: [
        { who: "Quality department", why: "inherited from /Procedures" },
        { who: "Approver role", why: "direct access" },
      ],
    },
    clips: {
      eyebrow: "In action",
      title: "See it working",
      items: [
        {
          name: "control",
          title: "Controlled documents",
          text: "Version history, what changed, the approval and the watermarked PDF.",
        },
        {
          name: "qr",
          title: "QR codes for the shop floor",
          text: "Generate the QR code and, when scanned, it always opens the current version.",
        },
        {
          name: "bian",
          title: "Bian, the AI assistant",
          text: "Answers from the current documents each person can see, and cites the source.",
        },
        {
          name: "compartir",
          title: "Who has access and why",
          text: "Every document explains who can get in and for what reason.",
        },
        {
          name: "conector",
          title: "Connector for Claude",
          text: "Claude searches and reads your current documents, with each person's permissions, and takes you to the source.",
        },
      ],
    },
    featuresAnchor: "features",
    featuresEyebrow: "Features",
    featuresTitle: "Documentation and health & safety, in one place",
    features: [
      {
        icon: "folder",
        tone: "success",
        title: "Files and folders",
        items: [
          "Library organized by spaces",
          "Notion-style pages",
          "Import your existing folders",
        ],
      },
      {
        icon: "users",
        tone: "warning",
        title: "Permissions by department",
        items: [
          "Access by department and role",
          "Every access explains why it exists",
          "When someone changes teams, their access follows",
        ],
      },
      {
        icon: "file-check",
        tone: "primary",
        title: "Controlled documents",
        items: [
          "Code, version and approval",
          "A single current version",
          "Read confirmation per version",
        ],
      },
      {
        icon: "shield",
        tone: "warning",
        title: "Health & safety",
        items: [
          "PPE with signed handouts and replacement",
          "Training, accidents and rates",
          "Planning, emergencies and committee",
        ],
      },
      {
        icon: "qr",
        tone: "info",
        title: "Contractors (CAE)",
        items: [
          "Each company's and worker's documents, with expiries",
          "QR gatehouse: can come in or not, and why",
          "A portal for contractors to upload their own",
        ],
      },
      {
        icon: "grid",
        tone: "success",
        title: "Forms and records",
        items: [
          "Inspections and checks with QR codes",
          "Non-conforming answers that create measures",
          "Exportable records",
        ],
      },
      {
        icon: "clipboard",
        tone: "info",
        title: "Audit log",
        items: [
          "Exportable log and controlled PDF",
          "Read and access reports",
          "Audit rooms for the external auditor",
        ],
      },
      {
        icon: "sparkles",
        tone: "primary",
        title: "AI assistant",
        items: [
          "Answers only from current content",
          "Respects each person's permissions",
          "Always cites the source",
        ],
      },
      {
        icon: "lock",
        tone: "success",
        title: "Administration",
        items: [
          "Members, roles and departments",
          "Two-step verification",
          "Optional limits set by your company",
        ],
      },
    ],
    areas: {
      eyebrow: "By area",
      title: "Each department goes to its own space",
      text: "The app is organized in areas, each with its own menu. Everyone sees only the ones they use and goes straight to theirs.",
      soon: "Coming soon",
      items: [
        {
          icon: "home",
          title: "Home",
          text: "What's pending for each person: reading, approvals, forms, expiries and measures.",
          soon: false,
        },
        {
          icon: "file-check",
          title: "Documentation",
          text: "Controlled documents, approvals, reading, expiries and audit rooms.",
          soon: false,
        },
        {
          icon: "book",
          title: "Wiki",
          text: "Each department's spaces, with pages and files.",
          soon: false,
        },
        {
          icon: "shield",
          title: "Health & safety",
          text: "PPE, training, accidents, planning, emergencies, committee and contractors (CAE).",
          soon: false,
        },
        {
          icon: "check",
          title: "Quality",
          text: "Food quality (IFS 8 and BRCGS 9): nonconformities with their cause, corrective and preventive actions and the effectiveness check.",
          soon: false,
        },
        {
          icon: "lock",
          title: "Administration",
          text: "Members, departments, roles, security and limits, only for whoever administers.",
          soon: false,
        },
      ],
    },
    plant: {
      eyebrow: "Built for the shop floor",
      title: "The current version, right at the workstation",
      items: [
        {
          icon: "qr",
          title: "QR codes",
          text: "A QR code at the workstation that always opens the current version of the procedure.",
        },
        {
          icon: "clock",
          title: "Expiry dates",
          text: "Reminders before a document expires, so nothing goes out of date.",
        },
        {
          icon: "users",
          title: "Tablets with a PIN",
          text: "Operators sign in with a username and PIN on a shared tablet and confirm they read what applies to them.",
        },
      ],
    },
    why: {
      anchor: "why",
      eyebrow: "Why",
      title: `Shared folders vs. ${SITE.name}`,
      before: {
        title: "Shared folders",
        items: [
          "Nobody knows who can see what, or why.",
          "Five versions of the same procedure live side by side.",
          "When someone changes teams, permissions have to be fixed one by one.",
          "Audit evidence has to be gathered by hand.",
        ],
      },
      after: {
        title: SITE.name,
        items: [
          "Every document shows who has access and why.",
          "A single current version; earlier ones are archived.",
          "Access follows department and role, and updates itself.",
          "Reads, approvals and access are kept as exportable evidence.",
        ],
      },
    },
    finalTitle: "Get your documentation in order this week",
    finalText: "Install it on your server, create your company and start inviting your team.",
  },
  faq: {
    metaTitle: "FAQ",
    title: "Frequently asked questions",
    subtitle: "What people usually ask us before getting started.",
    items: [
      {
        q: "How much does it cost?",
        a: `${SITE.name} is free and open source (AGPLv3), with no per-user limits. You only pay for your server and, if you use Bian, the requests on your own Anthropic account. Some business features are optional commercial plugins: write to ${SITE.contactEmail} and we'll tell you the terms.`,
      },
      {
        q: "What do I need to install it?",
        a: "A Linux server with Docker, an email (SMTP) server and, to sign in from any device, a domain. The Install guide walks you through it step by step.",
      },
      {
        q: "Who can see each document?",
        a: "Access is given to departments and roles, not person by person. On every folder, file and page you can see who has access and why, for example “Quality department · inherited from /Procedures”.",
      },
      {
        q: "What is a controlled document?",
        a: "A document with a code, a version and an approval, with a single current version. Earlier versions are archived and every read is confirmed per version.",
      },
      {
        q: "Where is my data stored?",
        a: "On your server: the database, the files (on disk or in the S3 storage you choose) and the backups. Nothing goes through our servers.",
      },
      {
        q: "Does it cover health and safety and contractors?",
        a: "Yes. The Health & safety area (PRL or SST) brings PPE with signed handouts, training, accidents with their rates, preventive planning, emergencies and drills, and the committee. Contractor coordination (CAE) tracks each company's and worker's documents, answers at the gatehouse whether someone can come in and gives each contractor a portal to upload their own. It's in the core, free, and turned on per company.",
      },
      {
        q: "What are plugins?",
        a: "Optional commercial features (advanced security policies, OneDrive import, MCP connector, industry templates) enabled with a license that is verified offline. Without them, everything else works the same.",
      },
      {
        q: "Does my team need to learn anything new?",
        a: "Very little. Shop-floor staff use a simple view to open the current version, for example from a QR code at their workstation.",
      },
      {
        q: `Can I leave ${SITE.name} and take my data with me?`,
        a: "Yes. The data lives on your server, and you can also export all of your company's information whenever you want.",
      },
      {
        q: "Which browsers are supported?",
        a: `Safari 16.4 or later, Chrome and Edge 111 or later, and Firefox 128 or later, including iOS 16.4 or later on phones and tablets. If your browser is older, ${SITE.name} tells you what to update.`,
      },
    ],
  },
  footer: {
    tagline: "Organized internal documentation for small businesses. Open source (AGPLv3).",
    columns: { product: "Product", resources: "Resources", legal: "Legal" },
    legalUpdated: (date: string) => `Updated ${date}`,
    links: {
      features: "Features",
      install: "Install",
      plugins: "Plugins and services",
      security: "Security",
      docs: "Documentation",
      faq: "FAQ",
      github: "GitHub",
      legalNotice: "Legal notice",
      privacy: "Privacy",
      terms: "Terms",
      cookies: "Cookies",
    },
    rights: (year: number, owner: string, name: string) =>
      `© ${String(year)} ${owner}. ${name} is licensed under AGPLv3.`,
  },
  docs: {
    nav: "Documentation",
    breadcrumb: "Docs",
    search: "Search the documentation",
    searchEmpty: "No results",
    toc: "On this page",
    top: "Back to top",
    start: "Get started",
    groups: {
      empezar: "Get started",
      "uso-diario": "For users",
      prevencion: "Health & safety",
      calidad: "Quality",
      administracion: "Administration",
      seguridad: "Security",
      autoalojamiento: "Self-hosting",
      desarrolladores: "Developers",
    },
  },
  notFound: { title: "We couldn't find this page", action: "Go to the home page" },
};
