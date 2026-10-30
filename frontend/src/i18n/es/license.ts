// Textos de Licencia y plugins, Límites y uso, y el backoffice de la instalación (español neutro).
export const licenseEs = {
  license: {
    title: "Licencia y plugins",
    subtitle:
      "Los plugins de este servidor. Los de pago funcionan con la licencia de tu empresa; los gratis los activas tú.",
    loadError: "No pudimos cargar los plugins",
    pluginsTitle: "Plugins",
    count: (shown: number, total: number) =>
      shown === total ? `${String(total)} instalados` : `${String(shown)} de ${String(total)}`,
    search: "Buscar un plugin",
    noPlugins: "No hay plugins instalados. Todo lo del núcleo funciona sin ellos.",
    noMatches: "Ningún plugin coincide con la búsqueda.",
    catalogLink: "Catálogo de plugins",
    badge: {
      paid: "De pago",
      free: "Gratis",
      unverified: "No verificado",
    },
    pluginState: {
      active: "Activo",
      off: "Desactivado",
      noLicense: "Sin licencia",
      expired: "Licencia vencida",
      removing: "Se quita al reiniciar",
      waiting: "Se carga al reiniciar",
    },
    replacedBy: (name: string) => `Reemplazado por ${name}`,
    replacedHint: (name: string) =>
      `${name} ya hace lo mismo y usa sus datos. Si ${name} deja de estar activo, este vuelve solo.`,
    licenseLine: (id: string) => `Licencia ${id}`,
    expires: (date: string) => `vence el ${date}`,
    expiresSoon: (days: number) => (days <= 1 ? "vence mañana" : `vence en ${String(days)} días`),
    expired: (date: string) => `venció el ${date}`,
    noExpiry: "sin vencimiento",
    noLicense: "Sin licencia: pídela con el ID de la empresa (abajo).",
    invalid: "La licencia cargada no es válida: carga la que te enviamos.",
    invalidWorkspace: "La licencia cargada es de otra empresa: carga la de esta empresa.",
    guide: "Guía",
    renew: "Renovar o cambiar licencia",
    loadLicense: "Cargar licencia",
    enable: "Activar",
    disable: "Desactivar",
    enabled: "Plugin activado",
    disabled: "Plugin desactivado",
    remove: "Quitar",
    more: (name: string) => `Más acciones de ${name}`,
    licenseDialog: {
      title: "Renovar o cambiar licencia",
      text: "La licencia de tu empresa incluye todos sus plugins de pago. Pega la nueva o sube el .sfplugin que te enviamos (trae la licencia adentro).",
      tokenLabel: "Licencia",
      tokenHint: "El texto completo que te enviamos, empieza con SFL1.",
      save: "Guardar licencia",
      saving: "Guardando…",
      saved: "Licencia guardada",
      removeLicense: "Quitar la licencia",
      removeTitle: "¿Quitar la licencia?",
      removeText:
        "Los plugins de pago dejan de funcionar en esta empresa. Sus ajustes se guardan por si vuelves a cargarla.",
      removing: "Quitando…",
      removed: "Licencia quitada",
    },
    removeDialog: {
      title: (name: string) => `¿Quitar «${name}» del servidor?`,
      text: "Se deja de cargar en el próximo reinicio. Sus datos y ajustes se guardan: si lo vuelves a subir, vuelve como estaba.",
      scheduled: "El reinicio se programa solo, en 1 minuto, con aviso a quien esté conectado.",
      manual: "Este servidor no se reinicia solo: quien lo administra reinicia la app y el worker.",
      multiCompany: "Se quita para todas las empresas de este servidor.",
      licenseKept: "La licencia no cambia.",
      confirm: "Quitar del servidor",
      pending: "Quitando…",
      done: (name: string) => `${name} se quita en el próximo reinicio`,
    },
    community: {
      hint: "De terceros: SpiderJAD no lo revisó ni lo firmó.",
      confirmTitle: (name: string) => `¿Activar «${name}»?`,
      confirmText:
        "No está verificado y corre dentro de este servidor, con acceso a los datos de todas sus empresas. Actívalo solo si confías en quien lo hizo.",
      confirm: "Activar de todos modos",
      enabling: "Activando…",
    },
    company: {
      label: "ID de la empresa",
      hint: "Envíanoslo para generar la licencia: solo funciona con este ID.",
      copy: "Copiar",
      copied: "ID copiado",
    },
    upload: {
      choose: "Subir plugin",
      uploading: "Verificando…",
      uploaded: (name: string, version: string) => `${name} ${version} instalado`,
      hint: "Un .sfplugin firmado por SpiderJAD: el que te enviamos o uno gratis del catálogo.",
      needsMfa:
        "Para subir o quitar plugins activa la verificación en dos pasos (Mi perfil › Seguridad).",
      multiCompany: "Este servidor tiene varias empresas: los plugins son de todo el servidor.",
    },
    restart: {
      waiting: (count: number) =>
        count === 1
          ? "Hay un cambio que se aplica al reiniciar."
          : `Hay ${String(count)} cambios que se aplican al reiniciar.`,
      now: "Reiniciar ahora",
      confirmTitle: "¿Reiniciar ahora?",
      confirmText:
        "La app y el worker se reinician en 1 minuto. Avisamos a quien esté conectado para que guarde, y la app vuelve sola en unos segundos.",
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
