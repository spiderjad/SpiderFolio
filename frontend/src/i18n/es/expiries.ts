// Vencimientos de archivos y páginas (docs/spec/vencimientos.md).

export const expiriesTexts = {
  nav: "Vencimientos",
  menu: "Vencimiento",
  pendingCount: (count: number) =>
    count === 1
      ? "1 vencimiento tuyo por atender"
      : `${String(count)} vencimientos tuyos por atender`,
  badge: {
    dueSoon: (date: string) => `Vence el ${date}`,
    expired: (date: string) => `Venció el ${date}`,
    open: "Ver el vencimiento",
  },
  states: { valid: "Vigente", due_soon: "Por vencer", expired: "Vencido" },
  dialog: {
    title: (name: string) => `Vencimiento de «${name}»`,
    description:
      "Avisa al responsable en la campana y por email, a las 8:00 de la empresa, los días que elijas.",
    dueOn: "Vence el",
    responsible: "Responsable",
    responsiblePlaceholder: "Sin responsable",
    department: "Departamento · avisa a jefes y subjefes",
    cantSee: "No puede ver este elemento",
    cantSeeWarning: (name: string) =>
      `${name} no puede ver este elemento: le van a llegar los avisos, pero no va a poder abrirlo. Compártelo con esa persona o elige otro responsable.`,
    noticeDays: "Avisar",
    notice: (days: number) =>
      days === 0 ? "El mismo día" : days === 1 ? "1 día antes" : `${String(days)} días antes`,
    noticeHint: "Si no eliges ninguno, avisa solo el mismo día.",
    note: "Nota",
    notePlaceholder: "Qué hay que hacer (por ejemplo, renovar con el proveedor).",
    save: "Guardar",
    saved: "Vencimiento guardado.",
    remove: "Quitar el vencimiento",
    removed: "Vencimiento quitado.",
    readOnly: "Solo lo cambia quien puede editar este elemento o gestiona los vencimientos.",
    none: "Este elemento no tiene vencimiento.",
    loadError: "No se pudo cargar el vencimiento.",
    invalidDate: "Elige la fecha en que vence.",
  },
  newVersion: {
    title: "¿Actualizar el vencimiento?",
    text: (before: string, proposed: string) =>
      `Este archivo vencía el ${before}. Con la versión nueva, ¿lo pasamos al ${proposed}? Es el mismo plazo que tenía.`,
    update: "Actualizar",
    other: "Elegir otra fecha",
    keep: "Dejar como está",
  },
  page: {
    title: "Vencimientos",
    subtitle:
      "Archivos y páginas con fecha de vencimiento: solo los que puedes ver. El responsable recibe los avisos.",
    csv: "Exportar CSV",
    views: { list: "Lista", calendar: "Calendario" },
    filters: {
      space: "Espacio",
      anySpace: "Todos los espacios",
      department: "Departamento",
      anyDepartment: "Todos",
      responsible: "Responsable",
      anyResponsible: "Cualquiera",
      status: "Estado",
      from: "Desde",
      to: "Hasta",
    },
    statuses: { all: "Todos", valid: "Vigentes", due_soon: "Por vencer", expired: "Vencidos" },
    columns: {
      dueOn: "Vence",
      element: "Elemento",
      space: "Espacio",
      responsible: "Responsable",
      state: "Estado",
    },
    empty: "No hay vencimientos con estos filtros.",
    emptyText:
      "Pon un vencimiento desde el menú «⋯» de un archivo o una página, o desde su pantalla.",
    calendar: {
      previous: "Mes anterior",
      next: "Mes siguiente",
      today: "Hoy",
      more: (count: number) => `y ${String(count)} más`,
      weekdays: ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"],
    },
  },
  home: {
    title: "Tus vencimientos",
    subtitle: "Lo que tienes a cargo, tú o tu departamento, por vencer o vencido.",
    seeAll: "Ver todos",
    more: (count: number) => `y ${String(count)} más`,
  },
};
