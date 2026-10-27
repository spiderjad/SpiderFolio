// Textos generales de la web pública en español neutro (tuteo): navegación, inicio, FAQ, pie y docs.
import { formatEur, formatUsd, PLUGIN_FROM } from "../../config/pricing.ts";
import { SITE } from "../../config/site.ts";

export const site = {
  nav: {
    features: "Funciones",
    install: "Instalación",
    plugins: "Plugins",
    docs: "Docs",
    faq: "FAQ",
  },
  a11y: {
    mainNav: "Principal",
    mobileNav: "Móvil",
    language: "Idioma",
    currentLanguage: "Idioma actual",
  },
  cta: { install: "Instalar", github: "Ver en GitHub", docs: "Ver documentación" },
  theme: { toggle: "Cambiar tema", menu: "Abrir menú", close: "Cerrar menú" },
  home: {
    eyebrow: "Open source · Documentación interna para pymes",
    title: "La documentación de tu empresa, por fin en orden.",
    subtitle:
      "Páginas, archivos y documentos controlados con permisos que se entienden, en tu propio servidor. Reemplaza el caos de carpetas compartidas por un lugar donde cada persona ve lo que le corresponde.",
    installNote: "Gratis y open source (AGPLv3). Se instala con Docker en una tarde.",
    mock: {
      path: "/Procedimientos/Control de documentos",
      status: "Documento controlado · Versión vigente",
      rows: [
        { who: "Departamento Calidad", why: "heredado de /Procedimientos" },
        { who: "Rol Aprobador", why: "acceso directo" },
      ],
    },
    featuresAnchor: "funciones",
    featuresEyebrow: "Funciones",
    featuresTitle: "Todo lo que necesita tu documentación",
    features: [
      {
        icon: "folder",
        tone: "success",
        title: "Archivos y carpetas",
        items: [
          "Biblioteca ordenada por espacios",
          "Páginas tipo Notion",
          "Importación de tus carpetas",
        ],
      },
      {
        icon: "users",
        tone: "warning",
        title: "Permisos por departamento",
        items: [
          "Acceso por departamentos y roles",
          "Cada acceso explica por qué existe",
          "Si alguien cambia de área, sus accesos cambian solos",
        ],
      },
      {
        icon: "file-check",
        tone: "primary",
        title: "Documentos controlados",
        items: [
          "Código, versión y aprobación",
          "Una sola versión vigente",
          "Confirmación de lectura por versión",
        ],
      },
      {
        icon: "clipboard",
        tone: "info",
        title: "Auditoría",
        items: ["Registro exportable", "PDF controlado", "Informes de lecturas y accesos"],
      },
      {
        icon: "sparkles",
        tone: "primary",
        title: "Asistente IA",
        items: [
          "Responde solo con contenido vigente",
          "Respeta los permisos de cada persona",
          "Cita siempre la fuente",
        ],
      },
      {
        icon: "shield",
        tone: "success",
        title: "Administración",
        items: [
          "Miembros, roles y departamentos",
          "Verificación en dos pasos",
          "Límites opcionales que fija la empresa",
        ],
      },
    ],
    plant: {
      eyebrow: "Pensado para la planta",
      title: "La versión vigente, en el puesto de trabajo",
      items: [
        {
          icon: "qr",
          title: "Códigos QR",
          text: "Un QR pegado en el puesto que siempre abre la versión vigente del procedimiento.",
        },
        {
          icon: "clock",
          title: "Vencimientos",
          text: "Avisos antes de que venza un documento, para que nada quede desactualizado.",
        },
        {
          icon: "users",
          title: "Tablets con PIN",
          text: "Los operarios entran con usuario y PIN en una tablet compartida y confirman la lectura de lo que les toca.",
        },
      ],
    },
    why: {
      anchor: "por-que",
      eyebrow: "Por qué",
      title: `Carpetas compartidas vs. ${SITE.name}`,
      before: {
        title: "Carpetas compartidas",
        items: [
          "Nadie sabe quién puede ver qué ni por qué.",
          "Conviven cinco versiones del mismo procedimiento.",
          "Si alguien cambia de área, hay que tocar permisos uno por uno.",
          "Para la auditoría hay que reunir pruebas a mano.",
        ],
      },
      after: {
        title: SITE.name,
        items: [
          "Cada documento muestra quién accede y por qué.",
          "Una única versión vigente; las anteriores quedan archivadas.",
          "El acceso va por departamento y rol, y se actualiza solo.",
          "Lecturas, aprobaciones y accesos quedan como evidencia exportable.",
        ],
      },
    },
    finalTitle: "Pon en orden tu documentación esta semana",
    finalText: "Instálalo en tu servidor, crea tu empresa y empieza a invitar a tu equipo.",
  },
  faq: {
    metaTitle: "FAQ",
    title: "Preguntas frecuentes",
    subtitle: "Lo que suelen preguntarnos antes de empezar.",
    items: [
      {
        q: "¿Cuánto cuesta?",
        a: `${SITE.name} es gratis y open source (AGPLv3), sin límites por usuario. Pagas solo tu servidor y, si usas a Bian, las consultas en tu cuenta de Anthropic. Algunas funciones para empresas son plugins comerciales opcionales, desde ${formatEur(PLUGIN_FROM.eur, "es")} sin IVA en España o ${formatUsd(PLUGIN_FROM.usd, "es")} en Latinoamérica (precio de lanzamiento).`,
      },
      {
        q: "¿Qué necesito para instalarlo?",
        a: "Un servidor Linux con Docker, un servidor de email (SMTP) y, para entrar desde cualquier equipo, un dominio. La guía de Instalación lo explica paso a paso.",
      },
      {
        q: "¿Quién ve cada documento?",
        a: "El acceso se da a departamentos y roles, no persona por persona. En cada carpeta, archivo y página puedes ver quién accede y por qué, por ejemplo «Departamento Calidad · heredado de /Procedimientos».",
      },
      {
        q: "¿Qué es un documento controlado?",
        a: "Un documento con código, versión y aprobación, con una única versión vigente. Las versiones anteriores quedan archivadas y cada lectura se confirma por versión.",
      },
      {
        q: "¿Dónde se guardan mis datos?",
        a: "En tu servidor: la base de datos, los archivos (en disco o en el S3 que elijas) y las copias de seguridad. Nada pasa por nuestros servidores.",
      },
      {
        q: "¿Qué son los plugins?",
        a: "Funciones comerciales opcionales (políticas de seguridad avanzadas, importación desde OneDrive, conector MCP, plantillas por rubro, salas de auditoría) que se activan con una licencia verificada sin conexión. Sin ellas, todo lo demás funciona igual.",
      },
      {
        q: "¿Mi equipo necesita aprender algo nuevo?",
        a: "Poco. Las personas de planta usan una vista simple para abrir la versión vigente, por ejemplo desde un código QR en su puesto.",
      },
      {
        q: `¿Puedo salir de ${SITE.name} con mis datos?`,
        a: "Sí. Los datos están en tu servidor y además puedes exportar toda la información de tu empresa cuando quieras.",
      },
      {
        q: "¿Qué navegadores admite?",
        a: `Safari 16.4 o superior, Chrome y Edge 111 o superior, y Firefox 128 o superior, incluido iOS 16.4 o superior en celulares y tablets. Si tu navegador es más antiguo, ${SITE.name} te avisa qué actualizar.`,
      },
    ],
  },
  footer: {
    tagline: "Documentación interna ordenada para pymes. Open source (AGPLv3).",
    columns: { product: "Producto", resources: "Recursos", legal: "Legal" },
    links: {
      features: "Funciones",
      install: "Instalación",
      plugins: "Plugins",
      security: "Seguridad",
      docs: "Documentación",
      faq: "Preguntas frecuentes",
      github: "GitHub",
      privacy: "Privacidad",
      terms: "Términos",
      cookies: "Cookies",
    },
    rights: (year: number, owner: string, name: string) =>
      `© ${String(year)} ${owner}. ${name} se distribuye bajo licencia AGPLv3.`,
  },
  docs: {
    nav: "Documentación",
    breadcrumb: "Docs",
    search: "Buscar en la documentación",
    searchEmpty: "Sin resultados",
    toc: "En esta página",
    top: "Volver arriba",
    start: "Empezar",
    groups: {
      empezar: "Empezar",
      "uso-diario": "Para usuarios",
      administracion: "Administración",
      seguridad: "Seguridad",
      autoalojamiento: "Autoalojamiento",
      desarrolladores: "Desarrolladores",
    },
  },
  notFound: { title: "No encontramos esta página", action: "Ir al inicio" },
} as const;
