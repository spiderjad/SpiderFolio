// Textos del panel de administración (CLAUDE.md, sección 9.3), en español neutro con tuteo.
// Se incorporan a i18n/es.ts: la app tiene un único punto de textos para i18n.

export const capabilityTexts = {
  "members.view": {
    label: "Ver miembros",
    description: "Ve la lista de miembros, sus roles y sus departamentos.",
  },
  "members.invite": {
    label: "Invitar personas",
    description: "Invita a personas al workspace, reenvía y revoca invitaciones.",
  },
  "members.manage": {
    label: "Gestionar miembros",
    description:
      "Cambia el rol, la plaza, el puesto y los departamentos de los miembros, y los quita.",
  },
  "members.suspend": {
    label: "Suspender miembros",
    description: "Suspende y reactiva miembros, y cierra sus sesiones.",
  },
  "members.pin": {
    label: "Gestionar el ingreso con PIN",
    description:
      "Crea personas que entran con usuario y PIN, resetea su PIN y ajusta el ingreso desde tablets compartidas.",
  },
  "departments.manage": {
    label: "Gestionar departamentos",
    description:
      "Crea, edita, mueve y borra departamentos, y administra quién pertenece a cada uno.",
  },
  "departments.members.own": {
    label: "Gestionar personas de sus departamentos",
    description:
      "Alcance propio: suma, quita y mueve personas, pero solo en los departamentos que lidera. Si deja de ser jefe, la pierde al instante.",
  },
  "roles.manage": {
    label: "Gestionar roles",
    description: "Crea y edita roles personalizados. Solo puede dar capacidades que ya tiene.",
  },
  "spaces.create": { label: "Crear espacios", description: "Crea espacios nuevos." },
  "spaces.manage": {
    label: "Gestionar espacios",
    description: "Edita, archiva y define los accesos de los espacios.",
  },
  "content.bypass": {
    label: "Acceso a todo el contenido",
    description: "Ve el contenido aunque no tenga permiso. Úsalo con cuidado.",
  },
  "permissions.audit": {
    label: "Auditar permisos",
    description: "Consulta quién puede ver qué y los reportes de acceso.",
  },
  "files.manage_trash": {
    label: "Gestionar la papelera",
    description: "Restaura o elimina definitivamente lo que hay en la papelera.",
  },
  "storage.view": {
    label: "Ver almacenamiento",
    description: "Consulta el uso de almacenamiento y los archivos más pesados.",
  },
  "documents.approve": {
    label: "Aprobar documentos",
    description: "Aprueba o rechaza las versiones de los documentos controlados.",
  },
  "documents.approve.own": {
    label: "Aprobar documentos de sus departamentos",
    description:
      "Alcance propio: aprueba o rechaza versiones, pero solo de los departamentos que lidera. Se activa con los documentos controlados.",
  },
  "documents.require_reading": {
    label: "Pedir lecturas",
    description: "Pide a personas o departamentos que lean y confirmen una versión.",
  },
  "content.public_qr": {
    label: "Códigos QR públicos",
    description: "Crea códigos QR que abren la versión vigente sin iniciar sesión.",
  },
  "audit.share": {
    label: "Compartir auditorías",
    description: "Arma salas de auditoría para auditores externos.",
  },
  "expirations.manage": {
    label: "Gestionar vencimientos",
    description: "Define y revisa los vencimientos de los documentos.",
  },
  "audit.view": {
    label: "Ver el registro de auditoría",
    description: "Consulta quién hizo qué y cuándo.",
  },
  "audit.export": {
    label: "Exportar la auditoría",
    description: "Descarga el registro de auditoría con los filtros aplicados.",
  },
  "security.manage": {
    label: "Gestionar la seguridad",
    description: "Cambia las políticas de seguridad del workspace.",
  },
  "workspace.settings": {
    label: "Ajustes de la empresa",
    description: "Cambia el nombre, el logo y el color del workspace, y fija sus límites.",
  },
} as const;

export const capabilityGroupTexts = {
  members: "Miembros",
  organization: "Organización",
  content: "Contenido",
  documents: "Documentos controlados",
  audit: "Auditoría",
  administration: "Administración",
  plugins: "Plugins",
} as const;

export const adminTexts = {
  nav: {
    group: "Gestión",
    members: "Miembros",
    departments: "Departamentos",
    roles: "Roles y permisos",
    access: "Accesos",
    security: "Seguridad",
    bian: "Bian",
    license: "Licencia y plugins",
    limits: "Límites y uso",
    audit: "Registro de auditoría",
  },
  security: {
    language: {
      title: "Idioma de la empresa",
      text: "Lo ven quienes no eligieron uno en Mi perfil. Se usa también en las invitaciones y en los PDF de documentos controlados.",
      label: "Idioma por defecto",
    },
    title: "Seguridad",
    subtitle: "Reglas de acceso y de privacidad de tu workspace.",
    visibility: {
      title: "Visibilidad de personas",
      text: "Define a quién ven los miembros en el directorio de personas (menciones y compartir). El propietario y los administradores siempre ven a toda la empresa.",
      label: "Los miembros ven",
      hint: "Los lectores y los invitados no ven el directorio.",
      company: "Toda la empresa",
      department: "Solo su departamento",
    },
    documents: {
      title: "Documentos controlados",
      text: "Cómo se aprueban los documentos controlados.",
      selfApproval: "Permitir autoaprobación",
      selfApprovalHint:
        "Desactivado: quien envía un documento a revisión no puede aprobarlo. Si lo activas, cada autoaprobación queda en la auditoría y en el historial como «aprobado por el propio autor».",
    },
    leaders: {
      title: "Jefes y subjefes",
      text: "Qué pueden hacer quienes lideran un departamento, dentro de su área y subáreas.",
      invite: "Los jefes pueden invitar a su área",
      inviteHint:
        "Solo como miembro o lector y solo a sus departamentos. Cada invitación avisa a los administradores y queda en Invitaciones pendientes.",
    },
    ownerOnly: "Seguridad es solo del propietario.",
    bian: {
      title: "Asistente Bian",
      text: "Bian responde preguntas con los documentos que cada persona ya puede ver, siempre con sus fuentes. Nunca ve lo que la persona no ve.",
      enabled: "Activar a Bian en tu empresa",
      enabledHint: "Si lo apagas, nadie puede preguntarle y se deja de indexar el contenido nuevo.",
      guests: "Permitir a invitados",
      guestsHint:
        "Los invitados externos solo ven lo que les compartieron, y Bian solo usa eso. Desactivado por defecto.",
    },
    tabs: { label: "Secciones de Seguridad", general: "General", email: "Email" },
    email: {
      title: "Remitente de email propio",
      text: "Los emails de tu empresa (invitaciones, avisos de documentos, compartidos) salen desde tu propio servidor SMTP. Los emails de cuenta (verificar email, contraseña, inicio de sesión) siempre salen de SpiderFolio.",
      unavailable: "El remitente propio no está disponible en este servidor.",
      status: {
        DRAFT: "Sin activar",
        ACTIVE: "Activo",
        DISABLED: "Desactivado",
      },
      tested: "Probado",
      notTested: "Sin probar",
      lastError: (error: string) => `Último error: ${error}`,
      fallbackNotice:
        "Hubo envíos que salieron por SpiderFolio porque falló tu servidor. Revisa la configuración y vuelve a probarla.",
      disabledNotice:
        "Desactivamos el remitente propio tras varios fallos seguidos. Corrige la configuración, envía una prueba y actívalo de nuevo.",
      fields: {
        fromName: "Nombre del remitente",
        fromEmail: "Dirección del remitente",
        fromEmailHint: "Tiene que ser una dirección que tu servidor SMTP te permita usar.",
        replyTo: "Responder a (opcional)",
        smtpHost: "Servidor SMTP",
        smtpPort: "Puerto",
        smtpSecurity: "Seguridad",
        smtpUser: "Usuario (opcional)",
        smtpPass: "Contraseña",
        smtpPassHint:
          "Se guarda cifrada y no se vuelve a mostrar. Déjala vacía para conservar la actual.",
        smtpPassSaved: "Guardada",
      },
      security: { STARTTLS: "STARTTLS (puerto 587)", TLS: "TLS (puerto 465)" },
      actions: {
        save: "Guardar",
        saving: "Guardando…",
        test: "Enviar email de prueba",
        testing: "Enviando…",
        activate: "Activar",
        deactivate: "Desactivar",
      },
      testHint: "La prueba llega a tu propio email. Hay que aprobarla para poder activar.",
      saved: "Configuración guardada. Envía una prueba para poder activarla.",
      testOk: "Prueba enviada. Revisa tu bandeja y activa el remitente.",
      activated: "Remitente propio activado.",
      deactivated: "Remitente propio desactivado.",
      domain: {
        title: "Dominio verificado",
        text: "En lugar de tu propio servidor SMTP, SpiderFolio envía con una dirección de tu dominio. Creas unos registros DNS, los verificamos y listo: no hace falta ninguna contraseña.",
        soon: "El envío con dominio verificado estará disponible próximamente.",
        domain: "Dominio",
        domainHint:
          "Por ejemplo, empresa.com. Es el dominio de las direcciones desde las que quieres enviar.",
        fromName: "Nombre del remitente",
        localPart: "Dirección (antes de la @)",
        localPartHint: "Por ejemplo, avisos.",
        replyTo: "Responder a (opcional)",
        register: "Obtener registros DNS",
        registering: "Registrando…",
        update: "Guardar remitente",
        recordsTitle: "Crea estos registros en el DNS de tu dominio",
        recordsHint:
          "Los cambios de DNS pueden tardar unas horas en propagarse. Cuando los hayas creado, pulsa «Verificar ahora».",
        columns: { type: "Tipo", name: "Nombre", value: "Valor", status: "Estado" },
        verified: "Verificado",
        pending: "Pendiente",
        verify: "Verificar ahora",
        verifying: "Verificando…",
        remove: "Quitar dominio",
        registered: "Dominio registrado. Crea los registros DNS y verifícalos.",
        allVerified: "Dominio verificado. Envía una prueba y activa el remitente.",
        stillPending: "Todavía hay registros sin verificar.",
        removed: "Dominio quitado.",
        mode: { SMTP: "Modo activo: SMTP propio", DOMAIN: "Modo activo: dominio verificado" },
      },
      guide: {
        title: "¿Tus emails caen en spam?",
        intro:
          "Para que los correos con tu dominio no caigan en spam, configura estos registros DNS en tu dominio. Tu proveedor de email te da los valores exactos.",
        spf: {
          title: "SPF",
          text: "Un registro TXT en tu dominio que dice qué servidores pueden enviar por ti. Solo puede haber uno: si ya tienes, agrega el include de tu proveedor.",
          example: "v=spf1 include:spf.tu-proveedor.com ~all",
        },
        dkim: {
          title: "DKIM",
          text: "Tu proveedor genera una clave y te da un registro TXT o CNAME (por ejemplo, selector._domainkey.tudominio.com). Créalo tal como te lo indica.",
          example: "selector._domainkey.tudominio.com  CNAME  selector.dkim.tu-proveedor.com",
        },
        dmarc: {
          title: "DMARC",
          text: "Un registro TXT en _dmarc.tudominio.com. Empieza con p=none (solo observa) y, cuando todo llegue bien, pasa a quarantine.",
          example: "v=DMARC1; p=none; rua=mailto:dmarc@tudominio.com",
        },
        test: {
          title: "Cómo comprobarlo",
          text: "Envía el email de prueba a tu bandeja y mira que no esté en spam. Si cae en spam, revisa que SPF y DKIM estén bien creados (los cambios de DNS pueden tardar unas horas) y que la dirección del remitente sea de tu dominio.",
        },
        copy: "Copiar",
        copied: "Copiado",
      },
    },
  },
  common: {
    search: "Buscar",
    all: "Todos",
    save: "Guardar",
    saving: "Guardando…",
    create: "Crear",
    creating: "Creando…",
    edit: "Editar",
    remove: "Quitar",
    delete: "Borrar",
    cancel: "Cancelar",
    close: "Cerrar",
    actions: "Acciones",
    results: (count: number) => (count === 1 ? "1 resultado" : `${String(count)} resultados`),
    loadError: "No pudimos cargar los datos",
    loadErrorText: "Revisa tu conexión y vuelve a intentarlo.",
    loadErrorServer: "Algo falló en el servidor. Vuelve a intentarlo.",
    saved: "Cambios guardados.",
    never: "Nunca",
    none: "Sin asignar",
  },
  limit: {
    title: "Se alcanzó un límite de la empresa",
    used: (used: number, max: number) => `Usas ${String(used)} de ${String(max)}.`,
    help: "Los límites los fija tu empresa. Quien tenga «Ajustes de la empresa» puede cambiarlos en Administración › Límites y uso.",
    close: "Entendido",
    limits: {
      storageGb: "almacenamiento",
      maxFileMb: "tamaño máximo de archivo",
      fileVersionsKept: "versiones guardadas por archivo",
      auditRetentionDays: "días de auditoría",
      aiQueriesPerMonth: "consultas a Bian por mes"
    } as Record<string, string>,
  },
  seats: {
    title: "Plazas",
    full: "Usuarios completos",
    reader: "Lectores",
    of: (used: number, max: number | null) =>
      max === null ? `${String(used)} (sin límite)` : `${String(used)} de ${String(max)}`,
    hint: "Las invitaciones pendientes también ocupan plaza.",
  },
  pin: {
    createButton: "Crear persona con PIN",
    locked: "PIN bloqueado",
    resetAction: "Resetear PIN",
    create: {
      title: "Crear persona con PIN",
      description:
        "Para quienes no tienen email: entran con un usuario y un PIN de 6 dígitos desde una tablet. Tienen plaza de lector.",
      name: "Nombre y apellido",
      loginName: "Usuario",
      loginNameHint: "De 3 a 32 letras minúsculas, números, punto, guion o guion bajo.",
      role: "Rol",
      roleHint: "Solo roles de miembro sin capacidades administrativas.",
      departments: "Departamentos",
      pin: "PIN (opcional)",
      pinHint: "Si lo dejas vacío, generamos uno aleatorio y te lo mostramos una sola vez.",
      pinPlaceholder: "6 dígitos",
      submit: "Crear",
      submitting: "Creando…",
    },
    reset: {
      title: "¿Resetear el PIN?",
      text: (name: string) =>
        `${name} recibirá un PIN nuevo y se cerrarán sus sesiones abiertas. Si estaba bloqueada, se desbloquea. Solo vas a ver el PIN una vez.`,
      action: "Resetear",
      pending: "Reseteando…",
    },
    reveal: {
      title: (name: string) => `Acceso de ${name}`,
      description: "Entrégale estos datos en persona. Entra desde la tablet de la planta.",
      loginName: "Usuario",
      pin: "PIN",
      copy: "Copiar PIN",
      copied: "PIN copiado.",
      copyFailed: "No se pudo copiar.",
      once: "Este PIN se muestra una sola vez: después no se puede consultar. Si se pierde, resetéalo.",
      done: "Listo",
    },
    settings: {
      title: "Ingreso con usuario y PIN",
      subtitle: "Para lectores de planta que comparten una tablet.",
      enabled: "Permitir el ingreso con usuario y PIN",
      enabledHint: "Mientras esté apagado, nadie puede entrar con PIN.",
      idle: "Cerrar la sesión por inactividad",
      idleHint: "Avisa 30 segundos antes de cerrar.",
      minutes: (count: number) => (count === 1 ? "1 minuto" : `${String(count)} minutos`),
      closeAfterConfirm: "Cerrar la sesión después de confirmar una lectura",
      address: "Dirección para las tablets",
      copy: "Copiar",
      copied: "Dirección copiada.",
    },
  },
  members: {
    title: "Miembros",
    subtitle: "Quién está en el workspace, con qué rol y en qué departamentos.",
    teamTitle: "Mi equipo",
    teamSubtitle: "Las personas de los departamentos que lideras y sus subáreas.",
    roleOf: (name: string) => `Rol de ${name}`,
    invite: "Invitar personas",
    importCsv: "Importar CSV",
    exportCsv: "Exportar CSV",
    exportDone: (rows: number) => `Exportadas ${String(rows)} personas.`,
    searchPlaceholder: "Buscar por nombre, email o puesto",
    filters: {
      role: "Rol",
      department: "Departamento",
      status: "Estado",
      managers: "Jefes de departamento",
    },
    noEmail: "Entra con usuario y PIN",
    views: {
      list: "Lista",
      orgChart: "Organigrama",
      label: "Vista",
    },
    legend: {
      title: "¿Qué puede hacer cada uno?",
      items: [
        ["Propietario y Administrador", "toda la empresa."],
        ["Jefe y Subjefe", "su departamento y sus subáreas."],
        ["Miembro", "usa lo que le dieron."],
        ["Lector", "lee y confirma lecturas."],
      ] as readonly (readonly [string, string])[],
      note: "El rol y el cargo son cosas distintas: un administrador puede ser además jefe de un departamento.",
    },
    summary: {
      label: "Resumen por jerarquía",
      all: "Todos",
      owner: "Propietario",
      admins: "Administradores",
      managers: "Jefes de departamento",
      members: "Miembros",
      readers: "Lectores",
      filterBy: (name: string) => `Filtrar por ${name.toLowerCase()}`,
    },
    roleBadge: {
      owner: "Propietario",
      admin: "Administrador",
      member: "Miembro",
      reader: "Lector",
      guest: "Invitado",
    },
    position: {
      head: (department: string) => `Jefe de ${department}`,
      deputy: (department: string) => `Subjefe de ${department}`,
      headShort: "Jefe",
      deputyShort: "Subjefe",
    },
    leadership: {
      title: "Jefatura",
      of: (departments: string) => `Jefe o subjefe de ${departments}`,
      scopeNote:
        "Su cargo rige en su departamento y sus subáreas: si deja de serlo, lo pierde al instante.",
    },
    people: (count: number) => (count === 1 ? "1 persona" : `${String(count)} personas`),
    peopleAndAreas: (people: number, areas: number) =>
      `${people === 1 ? "1 persona" : `${String(people)} personas`}${
        areas === 0 ? "" : ` · ${areas === 1 ? "1 subárea" : `${String(areas)} subáreas`}`
      }`,
    byDepartment: {
      seeMore: (remaining: number) => `Ver más (${String(remaining)})`,
      loadingMore: "Cargando…",
      noHead: "Sin jefe",
      noDepartments: "No hay departamentos que coincidan.",
      noDepartmentsAtAll: "Todavía no hay departamentos. Crea el primero desde Departamentos.",
      unassigned: "Sin departamento",
      unassignedHint: "Personas que todavía no pertenecen a ningún departamento.",
      emptyBlock: "Nadie en este departamento todavía.",
      assignHead: "Asignar jefe",
      changeHead: "Cambiar jefe",
      addDeputy: "Agregar subjefe",
      makeHead: "Nombrar jefe",
      makeDeputy: "Nombrar subjefe",
      removePosition: "Quitar el cargo",
      confirmRemovePosition: {
        title: (name: string, position: "HEAD" | "DEPUTY", department: string) =>
          `¿Quitar a ${name} como ${position === "HEAD" ? "jefe" : "subjefe"} de ${department}?`,
        text: (position: "HEAD" | "DEPUTY") =>
          position === "HEAD"
            ? "Seguirá en el departamento, pero dejará de gestionarlo y de aprobar sus documentos."
            : "Seguirá en el departamento, pero dejará de reemplazar al jefe.",
        action: (position: "HEAD" | "DEPUTY") =>
          position === "HEAD" ? "Quitar como jefe" : "Quitar como subjefe",
        pending: "Quitando…",
      },
      move: "Mover a otro departamento",
      searchPlaceholder: "Buscar un departamento",
      assign: {
        readerWarning: (name: string) =>
          `${name} es lector: el cargo de jefe necesita plaza completa.`,
        needsFullSeat: (name: string) =>
          `${name} es lector: necesita plaza completa para ejercer el cargo de jefe.`,
        titleHead: (department: string) => `Jefe de ${department}`,
        titleDeputy: (department: string) => `Subjefe de ${department}`,
        person: "Persona",
        description: "Elige a una persona del departamento.",
        search: "Buscar en el departamento",
        none: "No hay personas que coincidan.",
        submit: "Asignar",
        pending: "Asignando…",
        doneHead: (name: string) => `${name} es ahora jefe del departamento.`,
        doneDeputy: (name: string) => `${name} es ahora subjefe del departamento.`,
        removed: "Se quitó el cargo.",
      },
      moveDialog: {
        title: (name: string) => `Mover a ${name}`,
        description: (from: string) =>
          `Saldrá de ${from} (y perderá allí su cargo) y pasará al departamento que elijas.`,
        to: "Departamento de destino",
        toPlaceholder: "Busca un departamento",
        submit: "Mover",
        pending: "Moviendo…",
        done: (name: string, to: string) => `${name} ahora está en ${to}.`,
      },
    },
    structureReview: {
      title: "Revisión de la estructura",
      allGood: "La estructura está bien configurada",
      toFix: (count: number) => (count === 1 ? "1 para revisar" : `${String(count)} para revisar`),
      info: "Informativo",
      more: (count: number) => `y ${String(count)} más`,
      groups: {
        departmentsWithoutHead: {
          title: (n: number) =>
            n === 1 ? "1 departamento sin jefe" : `${String(n)} departamentos sin jefe`,
          hint: "Sin jefe nadie aprueba ni gestiona a su equipo.",
          action: "Abre el departamento y nombra un jefe.",
        },
        peopleWithoutDepartment: {
          title: (n: number) =>
            n === 1 ? "1 persona sin departamento" : `${String(n)} personas sin departamento`,
          hint: "No ven lo que se comparte con un departamento.",
          action: "Abre la ficha de la persona y asígnale un departamento.",
        },
        readerLeaders: {
          title: (n: number) =>
            n === 1 ? "1 jefe con plaza de lector" : `${String(n)} jefes con plaza de lector`,
          hint: "Con plaza de lector, el cargo de jefe no les da alcance sobre su área.",
          action: "Pásalos a plaza completa desde su ficha.",
        },
        emptyDepartments: {
          title: (n: number) =>
            n === 1 ? "1 departamento sin personas" : `${String(n)} departamentos sin personas`,
          hint: "Un departamento vacío no da acceso a nadie.",
          action: "Agrega personas al departamento o elimínalo.",
        },
        adminLeaders: {
          title: (n: number) =>
            n === 1
              ? "1 administrador que además es jefe"
              : `${String(n)} administradores que además son jefes`,
          hint: "Como administradores ya gestionan toda la empresa; el cargo solo ordena el organigrama.",
          action: "No hace falta corregir nada.",
        },
      },
    },
    orgChart: {
      root: (company: string) => company,
      owner: (name: string) => `Propietario: ${name}`,
      noOwner: "Sin propietario",
      seesAllAdmin:
        "Como administrador ves a toda la empresa. Los miembros solo ven su departamento.",
      seesAllLeader: "Como jefe ves a toda la empresa. Los miembros solo ven su departamento.",
      noHead: "Sin jefe",
      currentPath: "Ruta actual",
      expandAll: "Expandir todo",
      collapseAll: "Contraer todo",
      searchPlaceholder: "Buscar a una persona en el organigrama",
      searchNone: "No hay personas que coincidan.",
      searchHint: "Escribe al menos 2 letras.",
      open: (name: string) => `Abrir ${name}`,
      close: (name: string) => `Cerrar ${name}`,
      filteredBy: (name: string) => `Mostrando solo a «${name}»`,
      clearFilter: "Quitar filtro",
      empty: "Esta rama no tiene nada todavía.",
      branchLabel: "Organigrama de la empresa",
      moreAreas: (remaining: number) => `Ver más áreas (${String(remaining)})`,
    },
    status: { ACTIVE: "Activo", SUSPENDED: "Suspendido" },
    seat: { FULL: "Completa", READER: "Lector" },
    columns: {
      name: "Nombre",
      role: "Rol",
      departments: "Departamentos",
      seat: "Plaza",
      status: "Estado",
      lastSeen: "Último acceso",
      twoFactor: "2FA",
    },
    twoFactor: { on: "Activa", off: "—", onLabel: "Verificación en dos pasos activa" },
    you: "Tú",
    empty: {
      title: "Todavía no hay nadie más",
      text: "Invita a tu equipo para empezar a compartir la documentación.",
    },
    noResults: { title: "Sin resultados", text: "Prueba con otra búsqueda o quita algún filtro." },
    selected: (count: number) =>
      count === 1 ? "1 seleccionado" : `${String(count)} seleccionados`,
    selectAll: "Seleccionar todos",
    selectRow: (name: string) => `Seleccionar a ${name}`,
    rowActions: (name: string) => `Acciones para ${name}`,
    actions: {
      edit: "Editar",
      suspend: "Suspender",
      reactivate: "Reactivar",
      revokeSessions: "Cerrar sus sesiones",
      resetTwoFactor: "Reiniciar verificación en dos pasos",
      resetTwoFactorNeedsOwn:
        "Activa tu propia verificación en dos pasos para poder reiniciar la de otros.",
      remove: "Quitar del workspace",
    },
    bulk: {
      changeRole: "Cambiar rol",
      changeDepartments: "Departamentos",
      changeSeat: "Cambiar plaza",
      suspend: "Suspender",
      reactivate: "Reactivar",
      confirmSuspend: {
        title: (count: number) =>
          count === 1 ? "¿Suspender a 1 persona?" : `¿Suspender a ${String(count)} personas?`,
        text: "Perderán el acceso al workspace al instante y dejarán de ocupar plaza. Podrás reactivarlas cuando quieras.",
        word: "suspender",
        action: (count: number) =>
          count === 1 ? "Suspender a 1 persona" : `Suspender a ${String(count)} personas`,
        pending: "Suspendiendo…",
      },
      result: (ok: number, failed: number) =>
        failed === 0
          ? `Listo: ${String(ok)} actualizados.`
          : `${String(ok)} actualizados y ${String(failed)} no se pudieron cambiar.`,
      departmentMode: {
        add: "Agregar a los departamentos",
        remove: "Quitar de los departamentos",
        set: "Reemplazar los departamentos",
      },
      apply: "Aplicar",
    },
    edit: {
      title: (name: string) => `Editar a ${name}`,
      canSee: "Qué puede ver",
      role: "Rol",
      rolePlaceholder: "Busca un rol",
      departmentsPlaceholder: "Busca y agrega departamentos",
      seat: "Plaza",
      seatAutoHint:
        "Según el rol: plaza completa si tiene capacidades administrativas; lector si es un invitado externo.",
      seatHint:
        "Un rol con capacidades administrativas usa plaza completa; un invitado externo, plaza de lector.",
      departments: "Departamentos",
      noDepartments: "Todavía no hay departamentos.",
      guestDepartments: "Un invitado externo no entra a departamentos.",
      jobTitle: "Puesto",
      jobTitlePlaceholder: "Ej. Responsable de calidad",
      name: "Nombre y apellido",
      email: "Email",
      emailHint:
        "Si lo cambias, la persona tiene que confirmar el email nuevo y se cierran sus sesiones.",
      emailLockedHint: "Ya confirmó su email: lo cambia ella misma desde su cuenta.",
    },
    confirm: {
      suspend: {
        title: (name: string) => `¿Suspender a ${name}?`,
        text: (name: string) =>
          `${name} perderá el acceso a este workspace al instante y dejará de ocupar plaza. Podrás reactivar a la persona cuando quieras.`,
        action: "Suspender",
        pending: "Suspendiendo…",
      },
      reactivate: {
        title: (name: string) => `¿Reactivar a ${name}?`,
        text: (name: string) => `${name} volverá a entrar y a ocupar una plaza.`,
        action: "Reactivar",
        pending: "Reactivando…",
      },
      resetTwoFactor: {
        title: (name: string) => `¿Reiniciar la verificación en dos pasos de ${name}?`,
        text: (name: string) =>
          `Se borrarán su app vinculada, sus códigos de recuperación y sus dispositivos de confianza, y se cerrarán sus sesiones. ${name} recibirá un aviso por email y la configurará de nuevo al entrar.`,
        action: "Reiniciar",
        pending: "Reiniciando…",
      },
      revokeSessions: {
        title: (name: string) => `¿Cerrar las sesiones de ${name}?`,
        text: (name: string) =>
          `Se cerrarán todas las sesiones de ${name}, también en otros workspaces de su cuenta. Tendrá que volver a iniciar sesión.`,
        action: "Cerrar sesiones",
        pending: "Cerrando…",
      },
      remove: {
        title: (name: string) => `¿Quitar a ${name} del workspace?`,
        text: (name: string) =>
          `${name} dejará de pertenecer a este workspace y perderá todos sus accesos. Su cuenta no se borra, pero para volver tendrá que recibir una invitación nueva.`,
        action: "Quitar del workspace",
        pending: "Quitando…",
      },
    },
    toasts: {
      twoFactorReset: "Verificación en dos pasos reiniciada. Le avisamos por email.",
      updated: "Cambios guardados.",
      suspended: "Persona suspendida.",
      reactivated: "Persona reactivada.",
      removed: "Persona quitada del workspace.",
      sessionsRevoked: (count: number) =>
        count === 1 ? "Se cerró 1 sesión." : `Se cerraron ${String(count)} sesiones.`,
    },
  },
  invitations: {
    title: "Invitaciones pendientes",
    empty: "No hay invitaciones pendientes.",
    columns: { email: "Email", role: "Rol", seat: "Plaza", expires: "Vence", by: "Invitó" },
    searchPlaceholder: "Buscar por email",
    statusFilter: "Estado",
    statuses: { all: "Todas", pending: "Vigentes", expired: "Vencidas" },
    noResults: "Ninguna invitación coincide.",
    expired: "Venció",
    resend: "Reenviar",
    revoke: "Revocar",
    resent: "Invitación reenviada.",
    revoked: "Invitación revocada.",
    confirmRevoke: {
      title: (email: string) => `¿Revocar la invitación a ${email}?`,
      text: (email: string) =>
        `El enlace que le enviamos a ${email} dejará de funcionar. Podrás invitar a la persona de nuevo cuando quieras.`,
      action: "Revocar invitación",
      pending: "Revocando…",
    },
    dialog: {
      title: "Invitar personas",
      description: "Les enviaremos un email con un enlace para unirse. Vence en 7 días.",
      emails: "Emails",
      emailsHint: "Uno por línea, o separados por comas o espacios. Hasta 50.",
      role: "Rol",
      seatAutoHint:
        "Automática: plaza completa para miembros y administradores, lector para invitados externos",
      seat: "Plaza",
      seatAuto: "Automática",
      departments: "Departamentos",
      submit: "Enviar invitaciones",
      submitting: "Enviando…",
      noEmails: "Escribe al menos un email válido.",
      invalidEmails: (emails: string[]) => `No parecen emails válidos: ${emails.join(", ")}.`,
      sent: (count: number) =>
        count === 1 ? "Invitación enviada." : `${String(count)} invitaciones enviadas.`,
      skipped: (count: number) =>
        count === 1
          ? "1 persona se omitió porque ya es miembro o ya tiene una invitación pendiente."
          : `${String(count)} personas se omitieron porque ya son miembros o ya tienen una invitación pendiente.`,
      domainNotAllowed: "Estos emails no son de un dominio permitido.",
      verifyFirst: "Confirma tu email para poder invitar.",
    },
  },
  importCsv: {
    title: "Importar miembros desde CSV",
    description:
      "Sube un archivo con una fila por persona. Columnas: email (obligatoria), rol, departamentos (separados por |) y plaza (FULL o READER).",
    file: "Archivo CSV",
    tooLarge: "El archivo es demasiado grande (máximo 200 KB).",
    paste: "O pega el contenido",
    preview: "Vista previa",
    previewing: "Revisando…",
    confirm: "Invitar a las filas válidas",
    confirming: "Invitando…",
    summary: (ok: number, skip: number, error: number) =>
      `${String(ok)} listas para invitar · ${String(skip)} omitidas · ${String(error)} con errores`,
    done: (invited: number) =>
      invited === 1 ? "1 invitación enviada." : `${String(invited)} invitaciones enviadas.`,
    columns: { line: "Fila", email: "Email", role: "Rol", result: "Resultado" },
    status: { ok: "Lista", skip: "Omitida", error: "Error" },
    reasons: {
      invalid_email: "Email no válido",
      duplicate_in_file: "Repetido en el archivo",
      unknown_role: "El rol no existe",
      role_not_allowed: "No puedes invitar con ese rol",
      unknown_department: "El departamento no existe",
      guest_departments: "Un invitado externo no entra a departamentos",
      invalid_seat: "Plaza no válida para ese rol",
      domain_not_allowed: "Dominio no permitido",
      already_member: "Ya es miembro",
      already_invited: "Ya tiene una invitación pendiente",
    } as Record<string, string>,
  },
  departments: {
    title: "Departamentos",
    subtitle:
      "Las áreas de tu empresa. El acceso al contenido se da a departamentos, no persona por persona.",
    create: "Nuevo departamento",
    columns: {
      name: "Departamento",
      head: "Jefe",
      deputies: "Subjefe(s)",
      members: "Personas",
    },
    filters: { parent: "Dentro de", allParents: "Todos los niveles", root: "Nivel principal" },
    searchPlaceholder: "Buscar un departamento",
    noResults: { title: "Sin resultados", text: "Prueba con otra búsqueda o quita el filtro." },
    members: (count: number) => (count === 1 ? "1 persona" : `${String(count)} personas`),
    areas: (count: number) => (count === 1 ? "1 subárea" : `${String(count)} subáreas`),
    noHead: "Sin jefe",
    noDeputies: "—",
    expand: (name: string) => `Abrir ${name}`,
    collapse: (name: string) => `Cerrar ${name}`,
    seeMoreAreas: (remaining: number) => `Ver más subáreas (${String(remaining)})`,
    loadingMore: "Cargando…",
    inside: (parent: string) => `Dentro de ${parent}`,
    empty: {
      title: "Todavía no hay departamentos",
      text: "Crea el primero, por ejemplo Calidad o Producción, y agrega a las personas que lo forman.",
    },
    form: {
      createTitle: "Nuevo departamento",
      editTitle: "Editar departamento",
      name: "Nombre",
      description: "Descripción",
      color: "Color",
      parent: "Dentro de",
      noParent: "Ninguno (nivel principal)",
      head: "Jefe",
      noHead: "Sin jefe",
    },
    confirmDelete: {
      title: (name: string) => `¿Eliminar el departamento ${name}?`,
      text: (name: string, members: number, children: number) =>
        `${name} se eliminará y no se puede deshacer. ${String(members)} ${members === 1 ? "persona dejará" : "personas dejarán"} de pertenecer a él y perderán los accesos que les daba.${
          children > 0 ? ` Sus ${String(children)} subdepartamentos suben un nivel.` : ""
        }`,
      action: "Eliminar departamento",
      pending: "Borrando…",
    },
    toasts: {
      created: "Departamento creado.",
      updated: "Departamento actualizado.",
      deleted: "Departamento borrado.",
      membersAdded: (count: number) =>
        count === 0
          ? "Ya estaban en el departamento."
          : count === 1
            ? "1 persona agregada."
            : `${String(count)} personas agregadas.`,
      memberRemoved: "Persona quitada del departamento.",
    },
    workspace: {
      pickTitle: "Elige un departamento",
      pickText: "Selecciona uno del árbol para ver a su gente y sus subáreas.",
      mine: "Tu área",
      notFoundTitle: "No encontramos este departamento",
      notFoundText: "Puede que se haya eliminado o que no esté dentro de tu alcance.",
      addPeople: "Agregar personas",
      departmentActions: "Acciones del departamento",
      tabs: { people: "Personas", areas: "Subáreas" },
      views: { label: "Vista", areas: "Áreas", orgchart: "Organigrama" },
      path: "Ruta del departamento",
      head: "Jefe",
      deputy: "Subjefe",
      position: { HEAD: "Jefe", DEPUTY: "Subjefe", MEMBER: "Miembro" },
      positionOf: (name: string) => `Cargo de ${name}`,
      removeFromDepartment: "Quitar del departamento",
      noPeople: "Este departamento todavía no tiene personas.",
      newArea: "Nueva subárea",
      noAreas: "Este departamento no tiene subáreas.",
      needsFullSeat: (name: string) =>
        `${name} es lector: necesita plaza completa para ejercer el cargo de jefe.`,
    },
    detail: {
      back: "Volver a departamentos",
      members: "Miembros",
      searchMembers: "Buscar en el departamento",
      noResults: "Ninguna persona coincide con la búsqueda.",
      alreadyIn: "Ya está en el departamento",
      addMembers: "Agregar miembros",
      adding: "Agregando…",
      pickMembers: "Elige a quién agregar",
      noCandidates: "Todas las personas ya están en este departamento.",
      noMembers: "Este departamento todavía no tiene miembros.",
      removeMember: (name: string) => `Quitar a ${name} del departamento`,
      confirmRemoveMember: {
        title: (name: string, department: string) => `¿Quitar a ${name} de ${department}?`,
        text: (department: string) =>
          `Dejará de ver los documentos compartidos con ${department}. Podrás volver a agregar a la persona cuando quieras.`,
        action: (department: string) => `Quitar de ${department}`,
        pending: "Quitando…",
      },
      access: "Qué ve este departamento",
      accessEmpty:
        "Cuando existan espacios, carpetas y documentos, verás acá a cuáles da acceso este departamento.",
    },
  },
  roles: {
    title: "Roles y permisos",
    subtitle:
      "El rol define qué puede administrar cada persona; el departamento, qué contenido ve.",
    create: "Nuevo rol",
    system: "Roles de sistema",
    custom: "Roles personalizados",
    customEmpty: "Todavía no hay roles personalizados.",
    systemBadge: "Sistema",
    base: { OWNER: "Propietario", ADMIN: "Administrador", MEMBER: "Miembro", GUEST: "Invitado" },
    baseHint: {
      ADMIN: "Nivel de administrador",
      MEMBER: "Nivel de miembro",
      GUEST: "Externo, sin capacidades administrativas",
    },
    members: (count: number) => (count === 1 ? "1 persona" : `${String(count)} personas`),
    capabilities: (count: number) =>
      count === 0
        ? "Sin capacidades"
        : count === 1
          ? "1 capacidad"
          : `${String(count)} capacidades`,
    views: { list: "Lista", matrix: "Matriz" },
    searchPlaceholder: "Buscar un rol",
    filters: {
      kind: "Tipo",
      all: "Todos los roles",
      system: "De sistema",
      custom: "Personalizados",
    },
    noResults: { title: "Sin resultados", text: "Prueba con otra búsqueda o quita el filtro." },
    form: {
      createTitle: "Nuevo rol",
      editTitle: "Editar rol",
      name: "Nombre",
      description: "Descripción",
      base: "Rol base",
      capabilities: "Capacidades",
      notGrantable: "No puedes dar esta capacidad porque tú no la tienes.",
      guestNoCapabilities: "Un rol de invitado no lleva capacidades.",
    },
    matrix: { capability: "Capacidad" },
    confirmDelete: {
      title: (name: string) => `¿Eliminar el rol ${name}?`,
      text: (name: string) =>
        `El rol ${name} se eliminará y no se puede deshacer. Solo se puede si nadie lo usa.`,
      action: "Eliminar rol",
      pending: "Borrando…",
    },
    toasts: { created: "Rol creado.", updated: "Rol actualizado.", deleted: "Rol borrado." },
  },
  acceptInvite: {
    title: "Te invitaron a unirte",
    subtitle: (workspace: string) => `Te invitaron a ${workspace}.`,
    details: (inviter: string | null, role: string) =>
      inviter === null
        ? `Te sumas con el rol de ${role}.`
        : `${inviter} te invita con el rol de ${role}.`,
    createAccount: "Crea tu cuenta para entrar.",
    name: "Nombre y apellido",
    password: "Contraseña",
    passwordHint: "Mínimo 10 caracteres.",
    submit: "Aceptar y entrar",
    submitting: "Entrando…",
    haveAccount: "Este email ya tiene una cuenta. Inicia sesión para aceptar la invitación.",
    login: "Iniciar sesión",
    signedInAs: (email: string) => `Entrarás con tu cuenta ${email}.`,
    wrongAccount: (email: string) =>
      `Esta invitación es para ${email}. Cierra sesión e inicia con esa cuenta.`,
    accept: "Aceptar invitación",
    accepting: "Aceptando…",
    invalid: "El enlace no es válido o ya venció. Pide a quien te invitó que te envíe uno nuevo.",
    missing: "Abre esta página desde el enlace que te enviamos por email.",
    verifying: "Revisando la invitación…",
  },
} as const;
