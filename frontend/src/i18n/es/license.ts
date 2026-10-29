// Textos de Licencia y plugins, Límites y uso, y el backoffice de la instalación (español neutro).
export const licenseEs = {
  license: {
    title: "Licencia y plugins",
    subtitle:
      "SpiderFolio es open source. Los plugins comerciales se activan con una licencia que se verifica en este servidor, sin conexión.",
    loadError: "No pudimos cargar la licencia",
    status: {
      none: "Sin licencia",
      valid: "Licencia vigente",
      expired: "Licencia vencida",
      invalid: "Licencia no válida",
    },
    customer: (name: string) => `Emitida a ${name}`,
    expires: (date: string) => `Vence el ${date}`,
    noExpiry: "Sin vencimiento",
    expiredNote:
      "Los plugins de esta licencia dejaron de aplicarse. Sus ajustes se conservan y vuelven a aplicarse al cargar una licencia nueva.",
    invalidNote: "La licencia guardada no es válida: carga una nueva.",
    load: "Cargar licencia",
    replace: "Reemplazar licencia",
    remove: "Quitar licencia",
    removeTitle: "¿Quitar la licencia?",
    removeText:
      "Los plugins dejan de aplicarse en esta empresa. Sus ajustes se conservan por si vuelves a cargarla.",
    removed: "Licencia quitada",
    saved: "Licencia cargada",
    tokenLabel: "Licencia",
    tokenHint: "Pega el texto completo que te enviamos (empieza con SFL1.).",
    save: "Guardar licencia",
    saving: "Guardando…",
    cancel: "Cancelar",
    pluginsTitle: "Plugins instalados en este servidor",
    noPlugins: "Este servidor no tiene plugins instalados. Todo lo del núcleo funciona sin ellos.",
    pluginState: {
      active: "Activo",
      licensed: "En la licencia (vencida)",
      inactive: "Sin licencia",
    },
    community: {
      unverified: "No verificado",
      hint: "Plugin de terceros: SpiderJAD no lo revisó ni lo firmó.",
      enable: "Activar",
      disable: "Desactivar",
      confirmTitle: (name: string) => `¿Activar «${name}»?`,
      confirmText:
        "Es un plugin de terceros que no está verificado. Corre dentro de este servidor con acceso a sus datos y a los de todas las empresas de la instalación. Actívalo solo si confías en quien lo hizo.",
      confirm: "Activar de todos modos",
      enabling: "Activando…",
      enabled: "Plugin activado",
      disabled: "Plugin desactivado",
    },
    catalogLink: "Ver el catálogo de plugins",
    invalidWorkspace: "La licencia guardada es de otra empresa: carga la de esta empresa.",
    company: {
      title: "ID de la empresa",
      hint: "Envíanoslo para generar la licencia de tu empresa: solo funciona con este ID.",
      copy: "Copiar",
      copied: "ID copiado",
    },
    upload: {
      title: "Subir un plugin",
      text: "El archivo .sfplugin que te enviamos: trae el plugin firmado por SpiderJAD y la licencia de tu empresa. Se verifica en este servidor antes de instalarlo.",
      choose: "Elegir archivo .sfplugin",
      uploading: "Verificando e instalando…",
      uploaded: (name: string, version: string) => `${name} ${version} instalado`,
      needsMfa:
        "Para subir plugins necesitas tener activa la verificación en dos pasos (Mi perfil › Seguridad).",
      multiCompany:
        "Este servidor tiene varias empresas: el plugin se instala para todo el servidor. Cada empresa lo activa con su propia licencia.",
      communityNote:
        "Los plugins de terceros sin firma no se suben desde aquí: quien administra el servidor los copia en la carpeta de plugins.",
    },
    restart: {
      waiting: (list: string) => `Instalado, se carga al reiniciar: ${list}.`,
      now: "Reiniciar ahora",
      confirmTitle: "¿Reiniciar ahora?",
      confirmText:
        "La app y el worker se reinician en 1 minuto para cargar los plugins. Avisamos a todas las personas conectadas para que guarden lo que están editando, y la app vuelve sola en unos segundos.",
      confirm: "Reiniciar en 1 minuto",
      scheduling: "Programando…",
      scheduled: (time: string) => `Reinicio programado para las ${time}.`,
      manual:
        "Este servidor no se reinicia solo: quien lo administra reinicia la app y el worker (docker compose restart app worker).",
    },
    restartBanner: (seconds: number) =>
      seconds > 0
        ? `La app se reinicia en ${String(seconds)} s para cargar cambios del servidor. Guarda lo que estés editando.`
        : "La app se está reiniciando. Vuelve en unos segundos.",
  },
  limits: {
    title: "Límites y uso",
    subtitle:
      "Por defecto no hay límites. Fija los que le sirvan a tu empresa; se aplican a todos y se pueden cambiar cuando quieras.",
    loadError: "No pudimos cargar los límites",
    usageTitle: "Uso",
    storage: "Almacenamiento",
    members: "Personas",
    membersValue: (full: string, readers: string) =>
      `${full} con plaza completa · ${readers} lectores`,
    aiThisMonth: "Consultas a Bian este mes",
    of: (used: string, max: string) => `${used} de ${max}`,
    unlimited: "sin límite",
    limitsTitle: "Límites",
    noLimit: "Sin límite",
    save: "Guardar límites",
    saved: "Límites guardados",
    readOnly: "Solo quien tiene «Ajustes de la empresa» puede cambiarlos.",
    fields: {
      storageGb: {
        label: "Almacenamiento total",
        unit: "GB",
        hint: "Al llegar, no se pueden subir más archivos.",
      },
      maxFileMb: { label: "Tamaño máximo de un archivo", unit: "MB", hint: "Mínimo 1 MB." },
      fileVersionsKept: {
        label: "Versiones guardadas por archivo",
        unit: "versiones",
        hint: "Las más antiguas pasan a la papelera de versiones. Nunca afecta la vigente ni a los documentos controlados.",
      },
      auditRetentionDays: {
        label: "Conservar la auditoría",
        unit: "días",
        hint: "Mínimo 30 días. Sin límite, se guarda todo.",
      },
      aiQueriesPerMonth: {
        label: "Consultas a Bian por mes (toda la empresa)",
        unit: "consultas",
        hint: "También se cambia en Administración › Bian.",
      },
    },
  },
  internal: {
    title: "Empresas de esta instalación",
    subtitle: "Uso y límites de cada empresa. Solo cantidades: nunca contenido.",
    search: "Buscar empresa",
    created: (date: string) => `Alta: ${date}`,
    licensed: "Con licencia",
    empty: "No hay empresas que coincidan.",
    loadError: "No pudimos cargar las empresas",
  },
} as const;
