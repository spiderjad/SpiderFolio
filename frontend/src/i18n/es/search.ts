// Textos de la búsqueda: paleta Ctrl+K y resultados de texto completo.

export const searchTexts = {
  button: "Buscar",
  buttonHint: "Buscar (Ctrl+K)",
  page: {
    title: "Buscar",
    subtitle: "En los títulos, los códigos y el contenido de páginas, PDF y Word.",
    placeholder: "Busca una palabra o una frase",
    hintTitle: "Escribe al menos dos letras",
    hint: "Puedes buscar sin acentos, entre comillas para una frase exacta, o con un guion para excluir una palabra.",
    emptyTitle: (q: string) => `Nada para «${q}»`,
    empty: "Prueba con otra palabra. Solo se muestra lo que tienes permiso para ver.",
    loadError: "No se pudo buscar.",
    shown: (count: number, more: boolean) =>
      more ? `Mostrando ${String(count)} (hay más)` : `Mostrando ${String(count)}`,
  },
  palette: {
    title: "Buscar",
    placeholder: "Busca documentos, carpetas, espacios o personas…",
    pickSpace: "¿En qué espacio? Busca o elige uno",
    back: "Volver a la búsqueda",
    searching: "Buscando…",
    empty: (text: string) => `No encontramos nada para «${text}».`,
    noWritableSpaces: "No hay espacios donde puedas crear páginas.",
    newPage: "Nueva página",
    inContent: (text: string) => `Buscar «${text}» en el contenido`,
    goTo: (label: string) => `Ir a ${label}`,
    groups: {
      recent: "Recientes",
      documents: "Documentos",
      folders: "Carpetas",
      spaces: "Espacios",
      people: "Personas",
      actions: "Acciones",
    },
    hintNavigate: "↑ ↓ para moverte",
    hintOpen: "Enter para abrir",
  },
};
