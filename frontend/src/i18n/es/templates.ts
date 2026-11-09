// Company templates (docs/spec/plantillas.md): saving a page or folder as a template, using one and
// Admin › Templates with the industry packs.
export const templatesTexts = {
  title: "Plantillas",
  subtitle:
    "Las plantillas de la empresa y los paquetes por rubro. Una plantilla es una copia fija: si el original cambia, ella no.",
  tabs: { mine: "De la empresa", packs: "Paquetes por rubro" },
  kinds: { PAGE: "Página", FOLDER: "Carpeta" },
  allKinds: "Páginas y carpetas",
  allCategories: "Todas las categorías",
  search: "Buscar plantillas",
  count: (nodes: number) => (nodes === 1 ? "1 elemento" : `${String(nodes)} elementos`),
  skipped: (files: number) =>
    files === 1 ? "1 archivo no incluido" : `${String(files)} archivos no incluidos`,
  fromPack: "De un paquete",
  by: (name: string) => `Guardada por ${name}`,
  empty: {
    title: "Todavía no hay plantillas",
    text: "Guarda una página o una carpeta como plantilla desde su menú «⋯», o instala un paquete por rubro.",
  },
  noResults: "Ninguna plantilla coincide con la búsqueda.",
  edit: "Editar",
  delete: "Borrar",
  deleteTitle: (name: string) => `¿Borrar la plantilla «${name}»?`,
  deleteText: "Lo que ya se creó con ella no cambia. Sus imágenes se borran y liberan espacio.",
  deleted: "Plantilla borrada.",
  saved: "Plantilla guardada.",
  saving: "Guardando…",
  creating: "Creando…",
  installing: "Instalando…",
  deleting: "Borrando…",
  fields: {
    name: "Nombre",
    description: "Descripción",
    descriptionHint: "Para qué sirve y cuándo usarla.",
    category: "Categoría",
    categoryHint: "Opcional. Por ejemplo: Calidad, Producción, Personas.",
  },
  save: {
    action: "Guardar como plantilla",
    title: "Guardar como plantilla",
    page: "Se guarda el texto actual de la página con sus subpáginas y sus imágenes.",
    folder:
      "Se guardan las carpetas y páginas que puedes ver. Los archivos y formularios no se incluyen.",
    noComments: "No se copian comentarios ni menciones, ni los permisos.",
    submit: "Guardar plantilla",
    done: (name: string) => `Plantilla «${name}» guardada.`,
    skipped: (files: number) =>
      files === 1
        ? "1 archivo de la carpeta no se incluyó."
        : `${String(files)} archivos de la carpeta no se incluyeron.`,
  },
  use: {
    action: "Desde una plantilla de la empresa",
    title: "Crear desde una plantilla",
    text: "Se crea aquí con los permisos de esta carpeta. Los documentos controlados nacen en borrador con un código nuevo.",
    preview: "Contenido",
    controlled: "Documento controlado",
    submit: "Crear",
    created: (name: string) => `«${name}» creado desde la plantilla.`,
    controlledSkipped: (n: number) =>
      n === 1
        ? "1 documento controlado se creó como página normal: aquí no puedes gestionar documentos."
        : `${String(n)} documentos controlados se crearon como páginas normales: aquí no puedes gestionar documentos.`,
    pick: "Elige una plantilla",
    none: "La empresa todavía no tiene plantillas.",
    invalid: "Esta plantilla está dañada y no se puede usar.",
  },
  packs: {
    intro:
      "Conjuntos listos para empezar: carpetas, páginas modelo y tipos de documento. Son modelos orientativos: adáptalos a tu empresa.",
    none: "No hay paquetes disponibles.",
    folders: (n: number) => (n === 1 ? "1 carpeta" : `${String(n)} carpetas`),
    pages: (n: number) => (n === 1 ? "1 página" : `${String(n)} páginas`),
    controlled: (n: number) =>
      n === 1 ? "1 documento controlado" : `${String(n)} documentos controlados`,
    templates: (n: number) => (n === 1 ? "1 plantilla" : `${String(n)} plantillas`),
    installedAt: (date: string) => `Instalado el ${date}`,
    install: "Instalar",
    installAgain: "Instalar otra vez",
    contents: "Qué incluye",
    installTitle: (name: string) => `Instalar «${name}»`,
    space: "Espacio",
    spaceHint: "Se crea una carpeta con el paquete en la raíz del espacio.",
    types: "Tipos de documento",
    typeNew: "se agrega",
    typeExists: "ya existe",
    typesNoPermission:
      "Los tipos que falten no se agregan: hace falta poder configurar la empresa. Esas páginas se crean como páginas normales.",
    departments: "Departamentos sugeridos",
    departmentsHint: "Marca los que quieras crear. Ninguno se crea sin marcarlo.",
    departmentExists: "ya existe",
    departmentsNoPermission: "Para crear departamentos hace falta poder gestionarlos.",
    again:
      "Este paquete ya se instaló. Si sigues, se crea otra copia de sus carpetas; sus plantillas no se repiten.",
    submit: "Instalar paquete",
    done: (name: string) => `Paquete «${name}» instalado.`,
    open: "Abrir",
  },
} as const;
