// The plugin catalog: the only place each plugin is described for the website. The Plugins page (es
// and en) makes one card per entry: description, screenshot, compatible version, «Free» or «Paid»
// label, and «Download» (free) or «Contact» (paid). A free plugin's download is its .sfplugin in the
// «plugins» Release (npm run publicar-gratis in the plugins repository, which prints the file name).
// No plugin is published without its guide (`guide`, a key of src/i18n/routes.ts).
import type { DocKey } from "../i18n/routes.ts";
import type { Locale } from "../i18n/locales.ts";

export type IconName =
  "shield" | "folder" | "sparkles" | "file-check" | "clipboard" | "users" | "lock";

export interface CatalogPlugin {
  /** The plugin's id (its manifest). */
  id: string;
  icon: IconName;
  price: "free" | "paid";
  /** null: not available yet («Coming soon»). */
  version: string | null;
  /** The oldest SpiderFolio it works with. */
  minCore: string | null;
  /** Free: the file in the «plugins» Release. */
  file?: string;
  /** Its guide (docs). */
  guide?: DocKey;
  /** A screenshot (web/scripts/capturas.ts), shown on the card. */
  screenshot?: string;
  text: Record<Locale, { title: string; text: string }>;
}

export const PLUGINS: readonly CatalogPlugin[] = [
  {
    id: "microsoft-sign-in",
    icon: "lock",
    price: "free",
    version: "1.0.0",
    minCore: "0.3.0",
    file: "microsoft-sign-in-1.0.0.sfplugin",
    guide: "pluginMicrosoftSignIn",
    screenshot: "plugin-microsoft",
    text: {
      es: {
        title: "Entrar con Microsoft",
        text: "Las personas entran con su cuenta de Microsoft 365, sin otra contraseña. La primera vez se crea su cuenta como Miembro y tú le asignas los departamentos.",
      },
      en: {
        title: "Sign in with Microsoft",
        text: "People sign in with their Microsoft 365 account, with no other password. The first time, their account is created as a Member and you assign the departments.",
      },
    },
  },
  {
    id: "corporate-directory",
    icon: "users",
    price: "paid",
    version: "0.4.0",
    minCore: "0.3.0",
    guide: "pluginCorporateDirectory",
    screenshot: "plugin-directorio",
    text: {
      es: {
        title: "Directorio corporativo",
        text: "Entrar con Active Directory o Microsoft 365: los grupos deciden departamentos y roles, y cada hora se da de baja a quien ya no está. Incluye «Entrar con Microsoft».",
      },
      en: {
        title: "Corporate directory",
        text: "Sign in with Active Directory or Microsoft 365: groups decide departments and roles, and every hour whoever has left is suspended. Includes «Sign in with Microsoft».",
      },
    },
  },
  {
    id: "security-policies",
    icon: "shield",
    price: "paid",
    version: "0.1.0",
    minCore: "0.1.0",
    text: {
      es: {
        title: "Políticas de seguridad avanzadas",
        text: "Exige la verificación en dos pasos a toda la empresa o solo a quienes administran, y limita las invitaciones a los dominios de email de la empresa.",
      },
      en: {
        title: "Advanced security policies",
        text: "Require two-step verification for the whole company or only for administrators, and limit invitations to the company's email domains.",
      },
    },
  },
  {
    id: "onedrive-import",
    icon: "folder",
    price: "paid",
    version: null,
    minCore: null,
    text: {
      es: {
        title: "Importación desde OneDrive y SharePoint",
        text: "Trae carpetas y bibliotecas enteras a un espacio, con su estructura, sin descargarlas a mano.",
      },
      en: {
        title: "Import from OneDrive and SharePoint",
        text: "Bring whole folders and libraries into a space, with their structure, without downloading them by hand.",
      },
    },
  },
  {
    id: "claude-connector",
    icon: "sparkles",
    price: "free",
    version: "1.0.0",
    minCore: "0.4.0",
    file: "claude-connector-1.0.0.sfplugin",
    guide: "pluginClaudeConnector",
    screenshot: "plugin-claude",
    text: {
      es: {
        title: "Conector para Claude",
        text: "Cada persona conecta su Claude y le pregunta por los procedimientos, sus lecturas pendientes o los vencimientos. Claude solo ve lo que esa persona puede ver. Solo lectura.",
      },
      en: {
        title: "Connector for Claude",
        text: "Each person connects their Claude and asks it about procedures, their pending readings or upcoming reviews. Claude only sees what that person can see. Read-only.",
      },
    },
  },
  {
    id: "mcp-connector",
    icon: "sparkles",
    price: "paid",
    version: "0.2.0",
    minCore: "0.4.0",
    guide: "pluginMcpConnector",
    screenshot: "autorizar-app",
    text: {
      es: {
        title: "Conector para Claude: edición",
        text: "Además de leer, Claude crea y edita páginas, carpetas y archivos, comenta y envía a revisión, con los permisos de cada persona. Nunca publica ni borra. Incluye el Conector para Claude.",
      },
      en: {
        title: "Connector for Claude: editing",
        text: "Besides reading, Claude creates and edits pages, folders and files, comments and sends for review, with each person's permissions. It never publishes or deletes. Includes the Connector for Claude.",
      },
    },
  },
  {
    id: "templates",
    icon: "file-check",
    price: "paid",
    version: null,
    minCore: null,
    text: {
      es: {
        title: "Plantillas propias y por rubro",
        text: "Guarda páginas como plantilla de la empresa y usa colecciones listas para alimentación, industria o servicios.",
      },
      en: {
        title: "Your own and industry templates",
        text: "Save pages as company templates and use ready-made collections for food, manufacturing or services.",
      },
    },
  },
  {
    id: "audit-rooms",
    icon: "clipboard",
    price: "paid",
    version: null,
    minCore: null,
    text: {
      es: {
        title: "Salas de auditoría",
        text: "Comparte con el auditor externo solo lo que pide, por tiempo limitado, con marca de agua y registro de todo lo que consultó.",
      },
      en: {
        title: "Audit rooms",
        text: "Share with the external auditor only what they ask for, for a limited time, with a watermark and a record of everything they looked at.",
      },
    },
  },
];

/** The «plugins» Release, where the free plugins are downloaded from (never «latest»). */
export const PLUGINS_RELEASE = "plugins";
