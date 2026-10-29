// Textos del conector para Claude (docs/spec/conector-mcp.md): la pantalla de consentimiento, Mi
// perfil › Aplicaciones conectadas y la tarjeta de Administración › Seguridad (español neutro).
export const connectorTexts = {
  consent: {
    title: "Conectar una aplicación",
    subtitle: "Una aplicación quiere usar SpiderFolio en tu nombre.",
    loading: "Cargando…",
    app: (name: string) => `«${name}» quiere acceder a SpiderFolio como tú`,
    redirect: (host: string) => `Al terminar te devuelve a ${host}.`,
    verified: "Se identifica con un documento publicado por su autor.",
    loopback:
      "Esta aplicación solo vuelve a tu propio equipo (localhost). Permite solo si acabas de iniciar la conexión tú, desde un programa que conoces.",
    company: "Empresa",
    companyHelp:
      "La aplicación solo podrá usar esta empresa, con tus permisos en ella. Para otra empresa, conéctala otra vez.",
    noCompanies:
      "No tienes ninguna empresa donde se pueda usar el conector para Claude: tiene que estar instalado y activado, y no se puede usar como invitado.",
    willRead: "Buscar y leer los documentos y archivos a los que tienes acceso.",
    willWrite:
      "Crear y editar páginas, carpetas y archivos donde tú puedes editar, comentar y enviar a revisión.",
    readOnly: "En esta empresa solo podrá leer.",
    never:
      "Nunca podrá publicar ni aprobar documentos, confirmar lecturas por ti, borrar, cambiar permisos ni la configuración.",
    revokeHint: "Puedes desconectarla cuando quieras en Mi perfil › Aplicaciones conectadas.",
    allow: "Permitir",
    deny: "Cancelar",
    sending: "Un momento…",
    errors: {
      invalid_client: "No se reconoce la aplicación que pidió la conexión.",
      invalid_redirect_uri: "La aplicación pidió volver a una dirección que no tiene registrada.",
      invalid_request:
        "El pedido de conexión no es válido. Vuelve a intentarlo desde la aplicación.",
      expired: "El pedido de conexión venció. Vuelve a intentarlo desde la aplicación.",
      missing:
        "No hay ningún pedido de conexión. Empieza desde la aplicación que quieres conectar.",
    },
  },
  profile: {
    title: "Aplicaciones conectadas",
    text: "Aplicaciones como Claude que usan SpiderFolio en tu nombre en esta empresa, con tus permisos.",
    urlLabel: "URL para conectar Claude",
    urlHelp:
      "En Claude: Personalizar › Conectores › Agregar conector personalizado (Customize › Connectors › Add custom connector) y pega esta dirección.",
    copy: "Copiar",
    copied: "URL copiada",
    unavailable: "El conector para Claude no está disponible en esta empresa.",
    disabled: "El propietario desactivó el conector para Claude en esta empresa.",
    empty: "No tienes aplicaciones conectadas.",
    connectedAt: (date: string) => `Conectada el ${date}`,
    lastUsed: (date: string) => `último uso: ${date}`,
    neverUsed: "sin usar todavía",
    scopes: { read: "Leer", write: "Leer y editar" },
    disconnect: "Desconectar",
    confirmTitle: (name: string) => `¿Desconectar «${name}»?`,
    confirmText:
      "La aplicación deja de tener acceso al momento. Para volver a usarla, conéctala otra vez desde ella.",
    disconnected: "Aplicación desconectada",
  },
  admin: {
    title: "Conector para Claude",
    text: "Cada persona puede conectar su Claude con sus propios permisos. Aquí ves todas las conexiones de la empresa y puedes cortarlas.",
    enabled: "Conector activado en la empresa",
    enabledHint:
      "Desactivado: se rechazan las conexiones nuevas y las llamadas de las que ya existen, al momento.",
    writeOn: "Claude puede leer y editar (Conector para Claude: edición).",
    readOnly: "Claude solo puede leer (Conector para Claude).",
    unavailable:
      "Instala «Conector para Claude» (gratis) desde Licencia y plugins para que las personas puedan conectar Claude.",
    empty: "Nadie conectó una aplicación todavía.",
    person: "Persona",
  },
};
