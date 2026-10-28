// Textos de las páginas del proyecto open source (Inicio, Instalación, Plugins) en español neutro.
import { LATEST_BUNDLE_URL, SITE } from "../../config/site.ts";

export const oss = {
  cta: {
    install: "Instalar",
    github: "Ver en GitHub",
    contact: "Contactar",
    docs: "Ver la guía completa",
  },
  openSource: {
    eyebrow: "Open source",
    title: "Tuyo de verdad: tu servidor, tus datos, tu código",
    items: [
      {
        icon: "shield",
        title: "Licencia AGPLv3",
        text: "El código es abierto: lo puedes leer, auditar, modificar e instalar donde quieras. Si ofreces una versión modificada como servicio, compartes los cambios.",
      },
      {
        icon: "folder",
        title: "En tu servidor",
        text: "Los documentos, la base de datos y las copias quedan en tu infraestructura. Archivos en disco local o en el S3 que elijas.",
      },
      {
        icon: "users",
        title: "Sin límites por usuario",
        text: "No hay planes ni precios por persona. Invita a toda la planta: los límites, si quieres alguno, los fijas tú.",
      },
      {
        icon: "sparkles",
        title: "IA con tu propia clave",
        text: "Bian, el asistente, usa tu clave de la API de Anthropic. Fijas el total mensual y los límites por persona.",
      },
    ],
  },
  screenshots: {
    eyebrow: "Así se ve",
    title: "Capturas",
    items: [
      { file: "inicio", caption: "Inicio: lo pendiente de cada persona y el estado de la empresa" },
      { file: "explorador", caption: "Espacios y carpetas, con quién accede a cada cosa" },
      {
        file: "documento-controlado",
        caption: "Documento controlado: versión vigente y aprobaciones",
      },
      { file: "permisos", caption: "Permisos que se explican: quién accede y por qué" },
      { file: "bian", caption: "Bian responde con el contenido vigente y cita la fuente" },
      { file: "planta", caption: "Vista de planta: lecturas pendientes en una tablet" },
    ],
  },
  install: {
    title: "Instalación",
    subtitle: `${SITE.name} corre en tu servidor con Docker. En una tarde tienes la empresa funcionando.`,
    requirementsTitle: "Qué necesitas",
    requirements: [
      "Un servidor Linux con Docker y Docker Compose v2 (para probar, también Windows o macOS con Docker Desktop)",
      "2 vCPU y 4 GB de RAM (hasta ~200 personas)",
      "Un servidor de email SMTP (el de tu empresa o uno transaccional)",
      "Un dominio apuntando al servidor, para entrar con HTTPS desde cualquier equipo",
    ],
    steps: [
      {
        title: "Descarga",
        text: "Descarga el paquete de instalación de la última versión. En Windows, la guía tiene los comandos de PowerShell.",
        code: `curl -fsSL ${LATEST_BUNDLE_URL}.tar.gz | tar -xz\ncd spiderfolio`,
      },
      {
        title: "Configura",
        text: "El script pregunta dónde lo instalas (tu PC, un servidor con dominio o detrás de tu proxy) y los datos del email, genera los secretos y escribe .env. En Windows: setup.ps1.",
        code: "./setup.sh",
      },
      {
        title: "Arranca",
        text: 'Un comando levanta la base, la app y el worker. Las migraciones se aplican solas y, con un dominio, el certificado HTTPS también. La comprobación responde {"status":"ok"}.',
        code: "docker compose up -d\ncurl http://localhost:8080/api/health",
      },
      {
        title: "Crea tu empresa",
        text: "Entra a tu dirección, regístrate y quedas como propietario. Después invita a tu equipo desde Administración.",
        code: "https://docs.tu-empresa.com/register",
      },
    ],
    optionalTitle: "Opcional",
    optional: [
      {
        title: "PDF controlado",
        text: "Activa el perfil pdf (Gotenberg) para generar el PDF de los documentos controlados.",
      },
      {
        title: "Archivos en S3",
        text: "Por defecto van al disco del servidor. También puedes usar S3, R2 o MinIO.",
      },
      { title: "Bian, el asistente IA", text: "Activa Bian con tu clave de la API de Anthropic." },
      {
        title: "Plugins",
        text: "Funciones comerciales que se activan con una licencia, sin conexión.",
      },
    ],
    maintenanceTitle: "Mantenimiento",
    maintenance: [
      {
        title: "Actualizar",
        text: "docker compose pull && docker compose up -d, después de una copia.",
      },
      {
        title: "Copias de seguridad",
        text: "backup.sh guarda la base, los archivos y la configuración; restore.sh los recupera.",
      },
    ],
  },
  plugins: {
    title: "Plugins y servicios",
    subtitle: `${SITE.name} funciona completo sin plugins. Los plugins comerciales suman funciones para empresas que las necesitan, se instalan en tu servidor y se activan con una licencia que se verifica sin conexión. Si prefieres no hacerlo solo, también te ayudamos a ponerlo en marcha.`,
    pluginsTitle: "Plugins",
    howTitle: "Cómo funcionan",
    how: [
      "Se instalan en tu servidor, junto a tu instalación.",
      "El propietario carga la licencia en Administración › Licencia y plugins.",
      "Si la licencia vence, el plugin se desactiva y todo lo demás sigue igual. Sus ajustes se conservan.",
    ],
    status: { available: "Disponible", soon: "Próximamente" },
    items: [
      {
        id: "security-policies",
        icon: "shield",
        title: "Políticas de seguridad avanzadas",
        text: "Exige la verificación en dos pasos a toda la empresa o solo a quienes administran, limita las invitaciones a los dominios de email de la empresa y, próximamente, inicio de sesión único (SSO) con Microsoft 365 o Google Workspace.",
        available: true,
      },
      {
        id: "onedrive-import",
        icon: "folder",
        title: "Importación desde OneDrive y SharePoint",
        text: "Trae carpetas y bibliotecas enteras a un espacio, con su estructura, sin descargarlas a mano.",
        available: false,
      },
      {
        id: "mcp-connector",
        icon: "sparkles",
        title: "Conector MCP para Claude",
        text: "Claude lee y, con permiso, crea o edita la documentación de la empresa, con los permisos de cada persona y todo en la auditoría.",
        available: false,
      },
      {
        id: "templates",
        icon: "file-check",
        title: "Plantillas propias y por rubro",
        text: "Guarda páginas como plantilla de la empresa y usa colecciones listas para alimentación, industria o servicios.",
        available: false,
      },
      {
        id: "audit-rooms",
        icon: "clipboard",
        title: "Salas de auditoría",
        text: "Comparte con el auditor externo solo lo que pide, por tiempo limitado, con marca de agua y registro de todo lo que consultó.",
        available: false,
      },
    ],
    enterprise: {
      title: "Paquete Enterprise",
      text: "Todos los plugins en una sola licencia para tu instalación, con soporte prioritario.",
      items: [
        "Todos los plugins, presentes y futuros",
        "Soporte prioritario",
        "Licencia única para toda la instalación",
        "Condiciones a medida para varias empresas",
      ],
    },
    servicesAnchor: "servicios",
    servicesTitle: "Servicios",
    servicesText: "Si prefieres no hacerlo solo, te ayudamos.",
    services: [
      {
        id: "installation",
        icon: "terminal",
        title: "Instalación en tu servidor",
        text: `Dejamos ${SITE.name} funcionando en tu servidor, con HTTPS, email y copias de seguridad configurados.`,
      },
      {
        id: "support",
        icon: "message",
        title: "Soporte anual",
        text: "Ayuda por email con dudas, actualizaciones y problemas de tu instalación durante todo el año.",
      },
      {
        id: "consulting",
        icon: "book",
        title: "Consultoría o formación",
        text: "Organizamos contigo los espacios, departamentos y permisos, y formamos a quienes van a administrar.",
      },
      {
        id: "erp-connector",
        icon: "grid",
        title: "Conector con SAP o Business Central",
        text: "Integración a medida para enlazar la documentación con los datos de tu ERP.",
      },
    ],
    contactTitle: "¿Te interesa algún plugin o servicio?",
    contactText: `Escríbenos con el nombre de tu empresa y cuántas personas usarían ${SITE.name}, y te contamos las condiciones.`,
    contactSubject: (item: string) => `${SITE.name}: ${item}`,
  },
  landing: {
    command:
      `curl -fsSL ${LATEST_BUNDLE_URL}.tar.gz | tar -xz && cd spiderfolio && ./setup.sh`,
    commandLabel: "Comando de instalación",
    copy: "Copiar",
    copied: "Copiado",
    stars: (count: string) => `${count} estrellas en GitHub`,
    heroAlt:
      "El Inicio de SpiderFolio con los documentos vigentes, lo pendiente y la actividad de la empresa",
    howEyebrow: "Cómo funciona",
    howTitle: "Lo importante, de un vistazo",
    lifecycle: {
      title: "Un documento controlado, de principio a fin",
      text: "Cada versión pasa por revisión y aprobación. Solo una está vigente; al publicar la nueva, la anterior queda obsoleta y archivada.",
      code: "PRC-001",
      name: "Control de documentos",
      steps: ["Borrador", "En revisión", "Vigente", "Obsoleto"],
      approved: "Aprobado por Calidad",
    },
    permissions: {
      title: "Permisos por departamento que se explican solos",
      text: "El acceso se da a departamentos y roles. Si alguien cambia de área, sus accesos cambian con él, y cada carpeta dice quién entra y por qué.",
      departments: ["Calidad", "Producción", "Mantenimiento"],
      space: "/Procedimientos/Planta",
      why: "Producción · puede editar",
      people: ["Carmen", "Jorge", "Ana"],
    },
    qr: {
      title: "Un QR en el puesto, siempre la versión vigente",
      text: "Pega el código junto a la máquina: al escanearlo se abre la versión vigente del procedimiento, aunque se haya publicado una nueva ayer.",
      label: "INS-001 · Cortadora",
      version: "v3 · vigente",
      read: "Lectura confirmada",
    },
    bian: {
      title: "Bian responde con lo vigente y cita la fuente",
      text: "El asistente solo usa los documentos vigentes que cada persona puede ver, y siempre dice de dónde sacó la respuesta.",
      question: "¿Cada cuánto se limpia la sala de elaboración?",
      answer:
        "Al terminar cada turno y siempre que se cambie de producto: detergente alcalino 10 minutos, aclarar, desinfectar y registrar la limpieza.",
      source: "PRC-002 · Limpieza y desinfección · v2",
    },
    editions: {
      anchor: "ediciones",
      eyebrow: "Ediciones",
      title: "Gratis para siempre, con extras si los necesitas",
      subtitle:
        "El núcleo es open source y completo. Si lo necesitas, suma plugins, el paquete Enterprise o ayuda para ponerlo en marcha.",
      popular: "Para empresas",
      plans: [
        {
          id: "community",
          name: "Community",
          note: "AGPLv3 · para siempre",
          items: [
            "Todo el núcleo: archivos, páginas, permisos, documentos controlados, lecturas, QR y auditoría",
            "Bian con tu clave de Anthropic",
            "Sin límites por usuario",
            "Autoinstalable con Docker",
            "Soporte de la comunidad en GitHub",
          ],
          cta: "Instalar",
        },
        {
          id: "plugin",
          name: "Plugins",
          note: "por plugin y por instalación",
          items: [
            "Elige solo los que necesitas",
            "Licencia verificada sin conexión",
            "Actualizaciones mientras dure la licencia",
            "Soporte por email del plugin",
          ],
          cta: "Ver plugins",
        },
        {
          id: "enterprise",
          name: "Enterprise",
          note: "todos los plugins, por instalación",
          items: [
            "Todos los plugins, presentes y futuros",
            "Soporte prioritario",
            "Licencia única para toda la instalación",
            "Condiciones a medida para varias empresas",
          ],
          cta: "Contactar",
        },
      ],
      servicesTitle: "Servicios",
      servicesText:
        "Instalación en tu servidor, soporte anual, consultoría o formación y conectores con tu ERP.",
      servicesLink: "Ver los servicios",
      subject: (plan: string) => `${SITE.name}: ${plan}`,
    },
  },
} as const;
