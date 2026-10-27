// Plantillas de página en español (las de referencia).
import type { PageTemplate } from "./page-templates.ts";
import { callout, doc, h, items, p, table, tasks } from "./template-blocks.ts";

const NOTE = callout("info", "Modelo orientativo: adáptalo a tu empresa.");

export const pageTemplatesEs: readonly PageTemplate[] = [
  {
    id: "blank",
    name: "Página sin título",
    title: "En blanco",
    description: "Empieza de cero.",
    content: doc(p()),
  },
  {
    id: "procedure",
    name: "Procedimiento",
    title: "Procedimiento",
    description: "Objetivo, alcance, responsables, pasos y registros.",
    content: doc(
      NOTE,
      h(2, "1. Objetivo"),
      p("Describe en una o dos frases para qué existe este procedimiento."),
      h(2, "2. Alcance"),
      p("A qué áreas, procesos o productos se aplica (y a cuáles no)."),
      h(2, "3. Responsables"),
      table(
        ["Rol", "Responsabilidad"],
        [
          ["Jefe de área", "Aprueba y revisa este procedimiento."],
          ["Operario", "Ejecuta los pasos y completa los registros."],
        ],
      ),
      h(2, "4. Descripción"),
      items("orderedList", [
        "Primer paso: qué se hace, quién lo hace y con qué.",
        "Segundo paso.",
        "Tercer paso.",
      ]),
      h(2, "5. Registros"),
      tasks(["Formulario o registro que se completa", "Dónde se guarda y por cuánto tiempo"]),
      h(2, "6. Documentos relacionados"),
      items("bulletList", ["Otro procedimiento o instructivo relacionado"]),
      h(2, "7. Control de cambios"),
      table(
        ["Versión", "Fecha", "Descripción del cambio", "Autor"],
        [["1", "dd/mm/aaaa", "Emisión inicial.", "Nombre"]],
      ),
    ),
  },
  {
    id: "work-instruction",
    name: "Instructivo de trabajo",
    title: "Instructivo de trabajo",
    description: "Pasos de una tarea, con seguridad y criterios de aceptación.",
    content: doc(
      NOTE,
      h(2, "Objetivo"),
      p("Qué se logra al seguir este instructivo."),
      h(2, "Materiales y equipos"),
      tasks(["Material o herramienta 1", "Material o herramienta 2", "Equipo de protección"]),
      callout(
        "warning",
        "Seguridad: indica aquí los riesgos y el equipo de protección obligatorio.",
      ),
      h(2, "Pasos"),
      items("orderedList", [
        "Describe el primer paso con un verbo en infinitivo.",
        "Describe el segundo paso.",
        "Describe el tercer paso.",
      ]),
      h(2, "Criterios de aceptación"),
      tasks(["Qué se verifica al terminar", "Qué valor o resultado es correcto"]),
      h(2, "Si algo sale mal"),
      p("A quién avisar y qué hacer con el producto o el equipo afectado."),
    ),
  },
  {
    id: "meeting-minutes",
    name: "Acta de reunión",
    title: "Acta de reunión",
    description: "Datos, orden del día, acuerdos y tareas con responsables.",
    content: doc(
      table(
        ["Dato", "Detalle"],
        [
          ["Fecha y hora", "dd/mm/aaaa, 10:00"],
          ["Lugar", "Sala o enlace de la videollamada"],
          ["Asistentes", "Nombres y áreas"],
          ["Redacta", "Nombre"],
        ],
      ),
      h(2, "Orden del día"),
      items("orderedList", ["Primer tema", "Segundo tema"]),
      h(2, "Desarrollo"),
      h(3, "Primer tema"),
      p("Lo más importante que se dijo y se decidió."),
      h(2, "Acuerdos"),
      table(
        ["Acuerdo", "Responsable", "Fecha límite", "Estado"],
        [["Qué se acordó", "Nombre", "dd/mm/aaaa", "Pendiente"]],
      ),
      h(2, "Tareas"),
      tasks(["Tarea y responsable", "Tarea y responsable"]),
      h(2, "Próxima reunión"),
      p("Fecha, hora y temas a tratar."),
    ),
  },
  {
    id: "welcome",
    name: "Manual de bienvenida",
    title: "Manual de bienvenida",
    description: "Para quien se suma al equipo: primeros días, contactos y normas.",
    content: doc(
      NOTE,
      h(2, "Te damos la bienvenida"),
      p("Unas líneas cálidas sobre la empresa y lo que esperamos de las primeras semanas."),
      h(2, "Quiénes somos"),
      p("Qué hace la empresa, sus valores y cómo está organizada."),
      h(2, "Tu primer día"),
      tasks([
        "Recibir tu puesto y tus accesos",
        "Conocer al equipo y a tu jefe directo",
        "Leer las normas de seguridad",
        "Firmar la documentación pendiente",
      ]),
      h(2, "Contactos útiles"),
      table(
        ["Para…", "Habla con", "Contacto"],
        [
          ["Dudas de tu puesto", "Tu jefe directo", "Teléfono o correo"],
          ["Sistemas y accesos", "Soporte", "Teléfono o correo"],
          ["Nómina y permisos", "Recursos Humanos", "Teléfono o correo"],
        ],
      ),
      h(2, "Herramientas y accesos"),
      items("bulletList", ["Correo y calendario", "Esta plataforma de documentación"]),
      callout("warning", "Normas básicas de seguridad: indica aquí lo imprescindible."),
      h(2, "Tus primeras semanas"),
      items("orderedList", [
        "Semana 1: conocer procesos",
        "Semana 2: acompañar",
        "Semana 4: balance",
      ]),
      h(2, "Preguntas frecuentes"),
      p("¿Dónde pido ayuda? ¿Cómo registro mis horas? Agrega las dudas más comunes."),
    ),
  },
];
