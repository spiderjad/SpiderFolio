// Texts of the open source project pages (Home, Install, Plugins) in English.
import { SITE } from "../../config/site.ts";
import type { oss as esOss } from "../es/oss.ts";
import type { Catalog } from "../types.ts";

export const oss: Catalog<typeof esOss> = {
  cta: {
    install: "Install",
    github: "View on GitHub",
    contact: "Contact us",
    docs: "Read the full guide",
  },
  openSource: {
    eyebrow: "Open source",
    title: "Truly yours: your server, your data, your code",
    items: [
      {
        icon: "shield",
        title: "AGPLv3 license",
        text: "The code is open: you can read it, audit it, change it and install it wherever you want. If you offer a modified version as a service, you share your changes.",
      },
      {
        icon: "folder",
        title: "On your server",
        text: "Documents, the database and backups stay on your infrastructure. Files on local disk or in the S3 storage you choose.",
      },
      {
        icon: "users",
        title: "No per-user limits",
        text: "No plans and no per-person pricing. Invite the whole shop floor: limits, if you want any, are set by you.",
      },
      {
        icon: "sparkles",
        title: "AI with your own key",
        text: "Bian, the assistant, uses your Anthropic API key. You set the monthly total and the per-person limits.",
      },
    ],
  },
  screenshots: {
    eyebrow: "See it in action",
    title: "Screenshots",
    items: [
      { file: "inicio", caption: "Home: each person's to-dos and the state of the company" },
      { file: "explorador", caption: "Spaces and folders, showing who can access each item" },
      {
        file: "documento-controlado",
        caption: "Controlled document: current version and approvals",
      },
      { file: "permisos", caption: "Permissions that explain themselves: who has access and why" },
      { file: "bian", caption: "Bian answers from current content and cites the source" },
      { file: "planta", caption: "Shop-floor view: pending reads on a tablet" },
    ],
  },
  install: {
    title: "Install",
    subtitle: `${SITE.name} runs on your server with Docker. Your company can be up and running in an afternoon.`,
    requirementsTitle: "What you need",
    requirements: [
      "A Linux server with Docker and Docker Compose v2 (to try it, Windows or macOS with Docker Desktop too)",
      "2 vCPUs and 4 GB of RAM (up to ~200 people)",
      "An SMTP email server (your company's or a transactional service)",
      "A domain pointing to the server, to sign in over HTTPS from any device",
    ],
    steps: [
      {
        title: "Download",
        text: "Clone the repository. On Windows, the guide shows how to download it without Git.",
        code: "git clone https://github.com/spiderjad/SpiderFolio.git\ncd SpiderFolio/deploy",
      },
      {
        title: "Configure",
        text: "The script asks where you're installing (your PC, a server with a domain or behind your proxy) and your email details, generates the secrets and writes .env. On Windows: setup.ps1.",
        code: "./setup.sh",
      },
      {
        title: "Start",
        text: 'One command starts the database, the app and the worker. Migrations run automatically and, with a domain, so does the HTTPS certificate. The check answers {"status":"ok"}.',
        code: "docker compose up -d\ncurl http://localhost:8080/api/health",
      },
      {
        title: "Create your company",
        text: "Go to your address, sign up and you become the owner. Then invite your team from Administration.",
        code: "https://docs.your-company.com/register",
      },
    ],
    optionalTitle: "Optional",
    optional: [
      {
        title: "Controlled PDF",
        text: "Turn on the pdf profile (Gotenberg) to generate the PDF of controlled documents.",
      },
      {
        title: "Files on S3",
        text: "By default they go to the server's disk. You can also use S3, R2 or MinIO.",
      },
      { title: "Bian, the AI assistant", text: "Turn on Bian with your Anthropic API key." },
      { title: "Plugins", text: "Commercial features enabled with a license, offline." },
    ],
    maintenanceTitle: "Maintenance",
    maintenance: [
      {
        title: "Update",
        text: "docker compose pull && docker compose up -d, after taking a backup.",
      },
      {
        title: "Backups",
        text: "backup.sh saves the database, the files and the configuration; restore.sh brings them back.",
      },
    ],
  },
  plugins: {
    title: "Plugins and services",
    subtitle: `${SITE.name} is complete without plugins. Commercial plugins add features for companies that need them, are installed on your server and are enabled with a license that is verified offline. If you would rather not do it alone, we can also help you get started.`,
    pluginsTitle: "Plugins",
    howTitle: "How they work",
    how: [
      "They are installed on your server, alongside your installation.",
      "The owner uploads the license in Administration › License and plugins.",
      "If the license expires, the plugin turns off and everything else keeps working. Its settings are kept.",
    ],
    status: { available: "Available", soon: "Coming soon" },
    items: [
      {
        id: "security-policies",
        icon: "shield",
        title: "Advanced security policies",
        text: "Require two-step verification for the whole company or only for admins, restrict invitations to your company's email domains and, coming soon, single sign-on (SSO) with Microsoft 365 or Google Workspace.",
        available: true,
      },
      {
        id: "onedrive-import",
        icon: "folder",
        title: "Import from OneDrive and SharePoint",
        text: "Bring entire folders and libraries into a space, with their structure, without downloading them by hand.",
        available: false,
      },
      {
        id: "mcp-connector",
        icon: "sparkles",
        title: "MCP connector for Claude",
        text: "Claude reads and, with permission, creates or edits your company's documentation, with each person's permissions and everything in the audit log.",
        available: false,
      },
      {
        id: "templates",
        icon: "file-check",
        title: "Custom and industry templates",
        text: "Save pages as company templates and use ready-made collections for food, manufacturing or services.",
        available: false,
      },
      {
        id: "audit-rooms",
        icon: "clipboard",
        title: "Audit rooms",
        text: "Share with an external auditor only what they ask for, for a limited time, with a watermark and a log of everything they viewed.",
        available: false,
      },
    ],
    enterprise: {
      title: "Enterprise bundle",
      text: "Every plugin in a single license for your installation, with priority support.",
      items: [
        "Every plugin, current and future",
        "Priority support",
        "A single license for the whole installation",
        "Custom terms for several companies",
      ],
    },
    servicesAnchor: "services",
    servicesTitle: "Services",
    servicesText: "If you would rather not do it alone, we can help.",
    services: [
      {
        id: "installation",
        icon: "terminal",
        title: "Installation on your server",
        text: `We get ${SITE.name} running on your server, with HTTPS, email and backups set up.`,
      },
      {
        id: "support",
        icon: "message",
        title: "Annual support",
        text: "Email help with questions, updates and issues on your installation all year round.",
      },
      {
        id: "consulting",
        icon: "book",
        title: "Consulting or training",
        text: "We organize spaces, departments and permissions with you, and train the people who will administer it.",
      },
      {
        id: "erp-connector",
        icon: "grid",
        title: "SAP or Business Central connector",
        text: "A custom integration that links your documentation with your ERP data.",
      },
    ],
    contactTitle: "Interested in a plugin or service?",
    contactText: `Write to us with your company's name and how many people would use ${SITE.name}, and we'll tell you the terms.`,
    contactSubject: (item: string) => `${SITE.name}: ${item}`,
  },
  landing: {
    command:
      "git clone https://github.com/spiderjad/SpiderFolio.git && cd SpiderFolio/deploy && cp .env.example .env",
    commandLabel: "Install command",
    copy: "Copy",
    copied: "Copied",
    stars: (count: string) => `${count} stars on GitHub`,
    heroAlt: "SpiderFolio's Home with current documents, pending tasks and the company's activity",
    howEyebrow: "How it works",
    howTitle: "What matters, at a glance",
    lifecycle: {
      title: "A controlled document, from start to finish",
      text: "Every version goes through review and approval. Only one is current; publishing a new one makes the previous one obsolete and archives it.",
      code: "PRC-001",
      name: "Document control",
      steps: ["Draft", "In review", "Current", "Obsolete"],
      approved: "Approved by Quality",
    },
    permissions: {
      title: "Department permissions that explain themselves",
      text: "Access goes to departments and roles. When someone changes teams, their access moves with them, and every folder says who gets in and why.",
      departments: ["Quality", "Production", "Maintenance"],
      space: "/Procedures/Plant",
      why: "Production · can edit",
      people: ["Olivia", "Noah", "Chloe"],
    },
    qr: {
      title: "A QR code at the workstation, always the current version",
      text: "Stick the code next to the machine: scanning it opens the current version of the procedure, even if a new one was published yesterday.",
      label: "INS-001 · Slicer",
      version: "v3 · current",
      read: "Reading confirmed",
    },
    bian: {
      title: "Bian answers with what's current and cites the source",
      text: "The assistant only uses the current documents each person can see, and always says where the answer came from.",
      question: "How often is the production room cleaned?",
      answer:
        "At the end of every shift and whenever the product changes: alkaline detergent for 10 minutes, rinse, disinfect and record the cleaning.",
      source: "PRC-002 · Cleaning and disinfection · v2",
    },
    editions: {
      anchor: "editions",
      eyebrow: "Editions",
      title: "Free forever, with extras when you need them",
      subtitle:
        "The core is open source and complete. If you need them, add plugins, the Enterprise bundle or help getting started.",
      popular: "For companies",
      plans: [
        {
          id: "community",
          name: "Community",
          note: "AGPLv3 · forever",
          items: [
            "The whole core: files, pages, permissions, controlled documents, readings, QR codes and audit",
            "Bian with your own Anthropic key",
            "No per-user limits",
            "Self-hosted with Docker",
            "Community support on GitHub",
          ],
          cta: "Install",
        },
        {
          id: "plugin",
          name: "Plugins",
          note: "per plugin and per installation",
          items: [
            "Pick only the ones you need",
            "License verified offline",
            "Updates while the license lasts",
            "Email support for the plugin",
          ],
          cta: "See plugins",
        },
        {
          id: "enterprise",
          name: "Enterprise",
          note: "every plugin, per installation",
          items: [
            "Every plugin, current and future",
            "Priority support",
            "A single license for the whole installation",
            "Custom terms for several companies",
          ],
          cta: "Contact us",
        },
      ],
      servicesTitle: "Services",
      servicesText:
        "Installation on your server, annual support, consulting or training, and ERP connectors.",
      servicesLink: "See the services",
      subject: (plan: string) => `${SITE.name}: ${plan}`,
    },
  },
};
