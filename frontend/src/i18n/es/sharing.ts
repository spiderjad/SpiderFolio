// Textos de «Compartir» (módulo 5), en español neutro con tuteo. Se incorporan a i18n/es.ts.

export const sharingTexts = {
  open: "Compartir",
  title: (name: string) => `Compartir «${name}»`,
  description:
    "Da acceso a departamentos (lo recomendado: cuando alguien cambia de área, sus accesos cambian solos) o a personas sueltas.",
  add: {
    title: "Dar acceso",
    department: "Departamento",
    person: "Persona",
    company: "Toda la empresa",
    companyHint:
      "Todos los miembros activos de la empresa, sin los invitados externos. Los lectores solo llegan a Comentar.",
    pickDepartment: "Elige un departamento",
    pickPerson: "Elige a una persona",
    searchDepartment: "Buscar un departamento",
    searchPerson: "Buscar una persona",
    level: "Nivel",
    expires: "Vence (opcional)",
    submit: "Dar acceso",
    submitting: "Dando acceso…",
    includeSubareas: "Incluir subáreas",
    includeSubareasHint:
      "Los miembros de los subdepartamentos también tienen este acceso. Si no la marcas, solo lo tiene el departamento elegido.",
    limitedHint: "Los lectores y los invitados externos no pueden editar ni gestionar.",
    emailHint: "A la persona le llega un aviso por email.",
  },
  levels: { VIEW: "Ver", COMMENT: "Comentar", EDIT: "Editar", MANAGE: "Gestionar" },
  saved: "Acceso guardado.",
  removed: "Acceso quitado.",
  grants: {
    title: "Accesos dados",
    empty: "Nadie tiene un acceso dado en forma directa aquí.",
    person: "Persona",
    department: "Departamento",
    company: "Todos los miembros activos",
    expires: (date: string) => `Vence ${date}`,
    subareas: "Incluye subáreas",
    by: (name: string) => `Lo dio ${name}`,
    inheritedFrom: (name: string) => `Heredado de «${name}»`,
    remove: (name: string) => `Quitar el acceso de ${name}`,
    level: (name: string) => `Nivel de ${name}`,
  },
  people: {
    title: "Quién puede entrar y por qué",
    search: "Buscar a una persona",
    empty: "Nadie tiene acceso.",
    none: "Ninguna persona coincide con la búsqueda.",
    truncated: "Hay más de 5.000 personas: se muestran las primeras. Usa el buscador.",
    reasonsMore: (count: number) => `y ${String(count)} motivo${count === 1 ? "" : "s"} más`,
  },
  reasons: {
    owner: "Es el propietario del espacio de trabajo.",
    admin: "Es administrador: gestiona todo el contenido.",
    bypass: "Tiene permiso para gestionar todo el contenido.",
    leaderHead: (department: string) => `Es jefe de ${department}.`,
    leaderDeputy: (department: string) => `Es subjefe de ${department}.`,
    member: (department: string) => `Es parte de ${department}.`,
    memberSubareas: (department: string) => `Es parte de ${department} (incluye subáreas).`,
    grantPerson: "Se le dio acceso directo.",
    grantCompany: "Toda la empresa tiene acceso.",
    grantDepartment: (department: string) => `Su departamento ${department} tiene acceso.`,
    company: "Es un espacio de toda la empresa.",
    visible: (department: string) => `Es un espacio visible de ${department}.`,
    expires: (date: string) => `Vence ${date}`,
    inheritedFrom: (name: string) => `Heredado de «${name}»`,
  },
  inheritance: {
    title: "Herencia",
    inherits: (name: string) => `Hereda los accesos de «${name}».`,
    cut: (name: string) => `No hereda de «${name}»: solo valen los accesos dados aquí.`,
    cutAction: "Cortar la herencia",
    restoreAction: "Restaurar la herencia",
    confirmCut: {
      title: "¿Cortar la herencia?",
      text: "Solo tendrán acceso quienes se den aquí (y propietario y administradores). Quien hoy llega por el elemento de arriba lo pierde.",
      action: "Cortar herencia",
      pending: "Cortando…",
    },
    confirmRestore: {
      title: "¿Restaurar la herencia?",
      text: "Volverá a valer lo que se dio en el elemento de arriba, además de lo dado aquí.",
      action: "Restaurar",
      pending: "Restaurando…",
    },
    cutDone: "Herencia cortada.",
    restored: "Herencia restaurada.",
    keptAccess:
      "Como ibas a perder el acceso, te dimos un acceso directo de «Gestionar» a ti. Puedes quitarlo cuando quieras.",
  },
  mark: {
    with: (names: string[], extra: number) => {
      const list =
        names.length <= 1
          ? (names[0] ?? "")
          : `${names.slice(0, -1).join(", ")} y ${names.at(-1) ?? ""}`;
      return extra > 0
        ? `Compartido con ${names.join(", ")} y ${String(extra)} más`
        : `Compartido con ${list}`;
    },
    expires: (date: string) => `vence ${date}`,
  },
  close: "Cerrar",
  loadError: "No se pudo cargar quién tiene acceso.",
} as const;
