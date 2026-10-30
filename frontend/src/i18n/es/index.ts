// Textos de la app en español neutro (tuteo, sin voseo). Es el catálogo de referencia: los demás
// idiomas (en/, y pt-BR/ más adelante) tienen la misma forma (`Messages` en ../index.ts).

import { adminTexts, capabilityGroupTexts, capabilityTexts } from "./admin";
import { auditEs } from "./audit";
import { bianEs } from "./bian";
import { licenseEs } from "./license";
import { accessAuditTexts } from "./access-audit";
import { documentsTexts } from "./documents";
import { qrTexts } from "./qr";
import { searchTexts } from "./search";
import { filesTexts } from "./files";
import { pagesTexts } from "./pages";
import { sharingTexts } from "./sharing";
import { profileTexts } from "./profile";
import { connectorTexts } from "./connector";
import { termsTexts } from "./terms";

export const es = {
  admin: adminTexts,
  capabilities: capabilityTexts,
  capabilityGroups: capabilityGroupTexts,
  audit: auditEs,
  bian: bianEs,
  license: licenseEs,
  files: filesTexts,
  sharing: sharingTexts,
  documents: documentsTexts,
  qr: qrTexts,
  search: searchTexts,
  accessAudit: accessAuditTexts,
  pages: pagesTexts,
  profile: profileTexts,
  connector: connectorTexts,
  terms: termsTexts,
  app: { name: "SpiderFolio", loading: "Cargando SpiderFolio…" },
  kiosk: {
    switchUser: "Cambiar de usuario",
    confirmed: "Lectura confirmada. Cerrando tu sesión…",
    idle: {
      title: "¿Sigues ahí?",
      text: "Por seguridad, cerramos la sesión cuando no se usa.",
      countdown: "segundos para cerrar la sesión",
      keep: "Seguir",
    },
    home: {
      greeting: (name: string) => (name === "" ? "Hola" : `Hola, ${name}`),
      subtitle: "Acá vas a ver los documentos que tienes que leer.",
      empty: {
        title: "Todavía no tienes documentos para leer",
        text: "Cuando haya un documento para ti, aparece acá. Al terminar, toca Cambiar de usuario.",
      },
    },
  },
  combobox: {
    loading: "Cargando…",
    empty: "Sin resultados",
    more: "Ver más",
    error: "No pudimos buscar",
    clear: (label: string) => `Quitar el filtro: ${label}`,
    remove: (name: string) => `Quitar ${name}`,
    search: "Buscar…",
    searchIn: (label: string) => `Buscar en ${label}`,
    add: "Agregar…",
    done: "Listo",
  },
  common: {
    loadMore: "Cargar más",
    loadingMore: "Cargando…",
    shownOf: (shown: number, total: number) => `Mostrando ${String(shown)} de ${String(total)}`,
    email: "Email",
    password: "Contraseña",
    name: "Nombre y apellido",
    company: "Nombre de la empresa",
    continue: "Continuar",
    backToLogin: "Volver a iniciar sesión",
    showPassword: "Mostrar contraseña",
    hidePassword: "Ocultar contraseña",
    retry: "Reintentar",
    close: "Cerrar",
    cancel: "Cancelar",
    undo: "Deshacer",
    undone: "Acción deshecha.",
    typeToConfirm: (text: string) => `Escribe «${text}» para confirmar`,
    logout: "Cerrar sesión",
    theme: { label: "Tema", light: "Claro", dark: "Oscuro", system: "Del sistema" },
    language: "Idioma",
  },
  errors: {
    generic: "Ocurrió un error inesperado. Inténtalo de nuevo en unos minutos.",
    network: "No pudimos conectar con SpiderFolio. Revisa tu conexión.",
    rateLimited: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
    required: "Completa este campo.",
    email: "Escribe un email válido.",
    passwordMin: "Usa al menos 10 caracteres.",
    passwordMax: "Usa como máximo 200 caracteres.",
    nameLength: "Entre 2 y 80 caracteres.",
  },
  auth: {
    benefits: {
      eyebrow: "Documentación interna",
      title: "La documentación de tu empresa, en orden.",
      subtitle: "Carpetas, páginas y documentos controlados con permisos que se entienden.",
      items: [
        "Permisos por departamento que se entienden de un vistazo",
        "Documentos controlados con versión vigente única",
        "Confirmación de lectura y auditoría lista para exportar",
      ],
    },
    login: {
      title: "Inicia sesión",
      subtitle: "Entra a la documentación de tu empresa.",
      submit: "Iniciar sesión",
      forgot: "¿Olvidaste tu contraseña?",
      noAccount: "¿Todavía no tienes cuenta?",
      register: "Empieza gratis",
      invalid: "Email o contraseña incorrectos.",
      directory: {
        with: (label: string) => `Entrar con ${label}`,
        username: "Usuario",
        or: "o con tu email",
        ownersOnly: "Acceso de propietarios con email y contraseña",
        invalid: "Usuario o contraseña incorrectos.",
        failure: {
          expired:
            "El inicio de sesión tardó demasiado o se abrió en otro navegador. Vuelve a intentarlo.",
          notAllowed: "Tu cuenta corporativa no tiene acceso a esta empresa.",
          emailTaken:
            "Ya hay una cuenta con el email de tu cuenta corporativa. Pídele al propietario de la empresa que la vincule.",
          unavailable: "Ese inicio de sesión no está disponible. Entra con tu email y contraseña.",
          failed: "No se pudo iniciar sesión. Vuelve a intentarlo.",
        },
      },
      directoryRequired: {
        title: "Entra con tu cuenta corporativa",
        text: (company: string) =>
          `En ${company} se entra con la cuenta corporativa. Cierra sesión y vuelve a entrar con ella.`,
        action: "Cerrar sesión",
      },
      mfa: {
        title: "Verificación en dos pasos",
        subtitle: "Escribe el código de 6 dígitos que muestra tu app de autenticación.",
        code: "Código",
        recoveryHint: "¿No tienes el teléfono? Escribe uno de tus códigos de recuperación.",
        remember: "Recordar este dispositivo 30 días",
        submit: "Verificar",
        back: "Volver",
        invalid: "El código no es correcto o ya se usó.",
      },
    },
    pin: {
      title: "Entrar con usuario y PIN",
      subtitle: "Escribe tu usuario y toca tu PIN de 6 dígitos.",
      workspaceSubtitle: "Escribe el código de tu empresa para entrar.",
      workspace: "Código de la empresa",
      workspacePlaceholder: "mi-empresa",
      loginName: "Usuario",
      pin: "PIN",
      digits: (typed: number, total: number) => `${String(typed)} de ${String(total)} dígitos`,
      erase: "Borrar",
      submit: "Entrar",
      invalid: "Usuario o PIN incorrectos.",
      rateLimited: "Demasiados intentos. Espera unos minutos o pide ayuda a tu responsable.",
    },
    register: {
      title: "Crea tu cuenta",
      subtitle: "Crea la empresa en este servidor y empieza a ordenar su documentación.",
      submit: "Crear cuenta",
      hasAccount: "¿Ya tienes cuenta?",
      login: "Inicia sesión",
      passwordHint: "Mínimo 10 caracteres.",
    },
    verify: {
      title: "Confirma tu email",
      verifying: "Confirmando tu email…",
      done: "Listo, tu email quedó confirmado.",
      invalid: "El enlace no es válido o ya venció.",
      missing: "Abre esta página desde el enlace que te enviamos por email.",
      goToApp: "Ir a SpiderFolio",
      resend: "Enviar un enlace nuevo",
      resent: "Te enviamos un enlace nuevo. Revisa tu email.",
      loginToResend: "Inicia sesión para pedir un enlace nuevo.",
    },
    forgot: {
      title: "Recupera tu contraseña",
      subtitle: "Te enviamos un enlace para elegir una nueva.",
      submit: "Enviar enlace",
      sent: "Si hay una cuenta con ese email, te enviamos un enlace. Vence en 1 hora.",
    },
    reset: {
      title: "Elige una contraseña nueva",
      submit: "Guardar contraseña",
      done: "Listo. Inicia sesión con tu contraseña nueva.",
      invalid: "El enlace no es válido o ya venció.",
      requestNew: "Pedir un enlace nuevo",
      newPassword: "Contraseña nueva",
    },
    unverifiedBanner: {
      text: "Confirma tu email para invitar a tu equipo y publicar documentos.",
      action: "Reenviar email",
      sent: "Te enviamos el email de confirmación.",
    },
  },
  shell: {
    home: "Inicio",
    openMenu: "Abrir menú",
    collapse: "Contraer menú",
    expand: "Expandir menú",
    search: "Buscar",
    admin: "Administración",
    adminBack: "Volver a la app",
    adminPlugins: "Plugins",
    company: {
      label: "Empresa",
      settings: "Configuración de la empresa",
      switch: "Cambiar de empresa",
    },
    account: { themeLight: "Tema claro", themeDark: "Tema oscuro" },
    create: {
      label: "Crear",
      page: "Nueva página",
      upload: "Subir archivos",
      space: "Nuevo espacio",
      pickSpaceToUpload: "Abre el espacio donde quieres subir los archivos.",
    },
    favorites: "Favoritos",
    favoritesAll: (total: number) => `Ver todos (${String(total)})`,
    favoritesEmpty: "Marca espacios con ★ para tenerlos acá",
    recents: "Recientes",
    help: "Ayuda y guías",
    pendingReadings: (count: number) =>
      count === 1 ? "1 lectura pendiente" : `${String(count)} lecturas pendientes`,
    pendingApprovals: (count: number) =>
      count === 1 ? "1 aprobación pendiente" : `${String(count)} aprobaciones pendientes`,
    newShared: "Hay compartidos nuevos",
    brand: "SpiderFolio",
    roles: { OWNER: "Propietario", ADMIN: "Admin", MEMBER: "Miembro", GUEST: "Invitado" },
    noWorkspaces: {
      title: "No tienes acceso a ningún workspace",
      text: "Pide a quien administra tu empresa que te invite, o crea una cuenta nueva.",
    },
    notFound: { title: "No encontramos esta página", action: "Ir al inicio" },
    routeError: {
      title: "Algo salió mal",
      text: "No pudimos mostrar esta pantalla. Recarga la página; si sigue igual, avisa a soporte.",
      updatedTitle: "SpiderFolio se actualizó",
      updatedText:
        "Hay una versión nueva de la aplicación. Recarga la página para seguir trabajando.",
      reload: "Recargar",
    },
    logoutDialog: {
      title: "¿Cerrar sesión?",
      text: "Saldrás de SpiderFolio en este dispositivo. Para volver a entrar necesitarás tu email y tu contraseña.",
      pending: "Cerrando sesión…",
    },
  },
  notifications: {
    title: "Avisos",
    label: "Avisos",
    labelUnread: (count: number) =>
      count === 1 ? "Avisos: 1 sin leer" : `Avisos: ${String(count)} sin leer`,
    markAll: "Marcar todas",
    empty: "No tienes avisos.",
    loadError: "No se pudieron cargar los avisos.",
    unreadMark: "Sin leer",
    shared: (who: string, what: string) => `${who} compartió «${what}» contigo`,
    sharedAnon: (what: string) => `Te compartieron «${what}»`,
    expiring: (what: string, when: string) => `Tu acceso a «${what}» ${when}`,
    expiringGranted: (who: string, what: string, when: string) =>
      who === "" ? `Un acceso a «${what}» ${when}` : `El acceso de ${who} a «${what}» ${when}`,
    noAccess: "Ya no tienes acceso a lo que te compartieron.",
    emailFallback:
      "Falló el servidor de email de tu empresa: los emails salieron por SpiderFolio. Revisa Seguridad › Email.",
    pluginNotice: "Aviso de un plugin de tu empresa.",
    directorySyncStopped:
      "El directorio de tu empresa dejó de sincronizarse porque su plugin ya no está activo: quien se va de la empresa ya no se suspende solo. Revisa Licencia y plugins.",
    emailFailing: (reason: string) =>
      `El email no está funcionando: revisa la configuración SMTP. Motivo: ${reason}`,
    smtpReasons: {
      AUTH: "el servidor rechazó el usuario o la contraseña.",
      SENDER_REJECTED:
        "el servidor rechazó el remitente o el destinatario (MAIL_FROM tiene que ser la misma casilla que SMTP_USER).",
      CONNECTION: "no se pudo conectar con el servidor SMTP (servidor, puerto o seguridad).",
      TLS: "no se pudo establecer la conexión segura (certificado o TLS).",
      UNKNOWN: "el servidor SMTP devolvió un error al enviar.",
    },
    readingRequired: (what: string) => `Debes leer «${what}»`,
    readingReminder: (what: string) => `Te falta confirmar la lectura de «${what}»`,
    bianUsage: (percent: number) =>
      `Tu empresa usó el ${String(percent)} % de las consultas de Bian de este mes.`,
    bianRequest: (who: string) =>
      who === "" ? "Piden más consultas de Bian." : `${who} pide más consultas de Bian.`,
    invitationByLeader: (who: string, email: string, departments: string) =>
      `${who === "" ? "Un jefe" : who} invitó a ${email === "" ? "una persona" : email}${departments === "" ? "" : ` a ${departments}`}.`,
    readingOverdueLeader: (who: string, what: string) =>
      `${who} no confirmó a tiempo la lectura de «${what}»`,
    approvalPending: (what: string) => `Aprobación pendiente: «${what}»`,
    approvalApproved: (what: string) => `«${what}» fue aprobado`,
    approvalRejected: (what: string) => `«${what}» fue rechazado`,
    approvalChanges: (who: string, what: string) =>
      who === "" ? `Piden cambios en «${what}»` : `${who} pidió cambios en «${what}»`,
    expiresToday: "vence hoy",
    expiresTomorrow: "vence mañana",
    expiresInDays: (days: number) => `vence en ${String(days)} días`,
    sharedToast: (count: number) =>
      count === 1 ? "Te compartieron 1 elemento." : `Te compartieron ${String(count)} elementos.`,
    sharedToastAction: "Ver",
  },
  dashboard: {
    title: "Inicio",
    greeting: (firstName: string, workspace: string) =>
      `Hola, ${firstName}. Esto es lo que pasa en ${workspace}${workspace.endsWith(".") ? "" : "."}`,
    sharedBanner: {
      text: (count: number) =>
        count === 1 ? "Te compartieron 1 elemento." : `Te compartieron ${String(count)} elementos.`,
      action: "Ver lo compartido",
    },
    kpis: {
      publishedDocuments: "Documentos vigentes",
      inReview: "En revisión",
      drafts: "Borradores",
      readingCompliance: "Cumplimiento de lectura",
      activePeople: "Personas activas (30 días)",
      storage: "Almacenamiento usado",
    },
    kpiContext: {
      publishedDocuments: {
        empty: "Publica tu primer documento controlado para empezar.",
        some: "Con su versión aprobada en uso.",
      },
      inReview: {
        empty: "Nada espera revisión.",
        some: "Esperan la decisión de quien aprueba.",
      },
      drafts: {
        empty: "No hay borradores abiertos.",
        some: "Todavía sin enviar a revisión.",
      },
      readingCompliance: {
        empty: "Pide lecturas para medir quién leyó cada versión.",
        some: "De las lecturas que pediste, ya confirmadas.",
      },
      activePeople: {
        empty: "Todavía no hay actividad.",
        some: "Con alguna acción en el último mes.",
      },
      storage: {
        empty: "Sube tus primeros archivos a un espacio.",
        unlimited: "Sin límite de almacenamiento.",
      },
    },
    storageOf: (used: string, total: string) => `${used} de ${total}`,
    activity: {
      title: "Actividad — últimos 30 días",
      emptyTitle: "Todavía no hay actividad",
      empty: "Cuando tu equipo suba, publique y lea documentos, verás la actividad aquí.",
      series: { uploads: "Subidas", publications: "Publicaciones", reads: "Lecturas confirmadas" },
    },
    pending: {
      title: "Mis pendientes",
      emptyTitle: "Estás al día",
      empty:
        "No tienes aprobaciones ni lecturas pendientes. Cuando te asignen una, aparecerá aquí.",
      kinds: { approval: "Aprobación", reading: "Lectura" },
      due: (date: string) => `Vence el ${date}`,
      overdue: "Vencida",
      read: "Leer",
      review: "Revisar",
      viewAllReadings: (total: number) => `Ver las ${String(total)} lecturas`,
      viewAllApprovals: (total: number) => `Ver las ${String(total)} aprobaciones`,
    },
    bian: {
      title: "Pregúntale a Bian",
      text: "Encuentra la respuesta en los documentos que ya puedes ver.",
      placeholder: "Por ejemplo: ¿cómo solicito vacaciones?",
      submit: "Preguntar",
    },
    shared: {
      title: "Compartido conmigo recientemente",
      emptyTitle: "Nada nuevo compartido",
      empty: "Lo que tu equipo comparta contigo aparecerá aquí.",
      by: (name: string) => `de ${name}`,
      all: "Ver todo lo compartido",
    },
    favorites: {
      title: "Favoritos",
      emptyTitle: "Sin favoritos",
      empty: "Marca espacios con ★ para tenerlos a mano.",
      all: "Ver todos",
    },
    leader: {
      compliance: {
        title: "Cumplimiento de lectura de tu área",
        emptyTitle: "Sin lecturas pedidas",
        empty: "Pide la lectura de un documento de tu área para seguir quién lo leyó.",
        of: (read: number, total: number) => `${String(read)} de ${String(total)} leyeron`,
        noAccess: (count: number) =>
          count === 1 ? "1 sin acceso al documento" : `${String(count)} sin acceso al documento`,
        overdue: (count: number) => (count === 1 ? "1 vencida" : `${String(count)} vencidas`),
        remind: "Recordar a los pendientes",
        reminded: (sent: number) =>
          sent === 0
            ? "Ya se les avisó hoy."
            : sent === 1
              ? "Se avisó a 1 persona."
              : `Se avisó a ${String(sent)} personas.`,
        allRead: "Todos leyeron",
      },
      reviewDue: {
        title: "Revisión próxima (60 días)",
        emptyTitle: "Nada por revisar",
        empty: "Ningún documento de tu área vence su revisión pronto.",
        on: (date: string) => `Revisar antes del ${date}`,
      },
      inReview: {
        title: "Esperando aprobación",
        emptyTitle: "Nada en revisión",
        empty: "Los documentos de tu área enviados a revisión aparecerán aquí.",
        since: (when: string) => `Enviado ${when}`,
      },
    },
    top: {
      title: "Más consultados del mes",
      emptyTitle: "Sin consultas este mes",
      empty: "Los documentos más abiertos por tu equipo aparecerán aquí.",
      people: (count: number) =>
        count === 1 ? "abierto por 1 persona" : `abierto por ${String(count)} personas`,
    },
    verifyAction: "Confirmar mi email",
    error: {
      title: "No pudimos cargar el inicio",
    },
  },
} as const;
