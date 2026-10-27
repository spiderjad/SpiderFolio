// Page templates in English (same ids and structure as page-templates-es.ts).
import type { PageTemplate } from "./page-templates.ts";
import { callout, doc, h, items, p, table, tasks } from "./template-blocks.ts";

const NOTE = callout("info", "Sample template: adapt it to your company.");

export const pageTemplatesEn: readonly PageTemplate[] = [
  {
    id: "blank",
    name: "Untitled page",
    title: "Blank",
    description: "Start from scratch.",
    content: doc(p()),
  },
  {
    id: "procedure",
    name: "Procedure",
    title: "Procedure",
    description: "Purpose, scope, responsibilities, steps and records.",
    content: doc(
      NOTE,
      h(2, "1. Purpose"),
      p("Describe in one or two sentences why this procedure exists."),
      h(2, "2. Scope"),
      p("Which areas, processes or products it applies to (and which it doesn't)."),
      h(2, "3. Responsibilities"),
      table(
        ["Role", "Responsibility"],
        [
          ["Area head", "Approves and reviews this procedure."],
          ["Operator", "Carries out the steps and fills in the records."],
        ],
      ),
      h(2, "4. Description"),
      items("orderedList", [
        "First step: what is done, who does it and with what.",
        "Second step.",
        "Third step.",
      ]),
      h(2, "5. Records"),
      tasks(["Form or record to fill in", "Where it's kept and for how long"]),
      h(2, "6. Related documents"),
      items("bulletList", ["Another related procedure or work instruction"]),
      h(2, "7. Change history"),
      table(
        ["Version", "Date", "Description of the change", "Author"],
        [["1", "mm/dd/yyyy", "First issue.", "Name"]],
      ),
    ),
  },
  {
    id: "work-instruction",
    name: "Work instruction",
    title: "Work instruction",
    description: "The steps of a task, with safety and acceptance criteria.",
    content: doc(
      NOTE,
      h(2, "Purpose"),
      p("What is achieved by following this work instruction."),
      h(2, "Materials and equipment"),
      tasks(["Material or tool 1", "Material or tool 2", "Protective equipment"]),
      callout("warning", "Safety: list the risks and the required protective equipment here."),
      h(2, "Steps"),
      items("orderedList", [
        "Describe the first step, starting with a verb.",
        "Describe the second step.",
        "Describe the third step.",
      ]),
      h(2, "Acceptance criteria"),
      tasks(["What is checked at the end", "Which value or result is correct"]),
      h(2, "If something goes wrong"),
      p("Who to tell and what to do with the affected product or equipment."),
    ),
  },
  {
    id: "meeting-minutes",
    name: "Meeting minutes",
    title: "Meeting minutes",
    description: "Details, agenda, agreements and tasks with owners.",
    content: doc(
      table(
        ["Item", "Details"],
        [
          ["Date and time", "mm/dd/yyyy, 10:00 AM"],
          ["Place", "Room or video call link"],
          ["Attendees", "Names and areas"],
          ["Minutes taken by", "Name"],
        ],
      ),
      h(2, "Agenda"),
      items("orderedList", ["First topic", "Second topic"]),
      h(2, "Discussion"),
      h(3, "First topic"),
      p("The most important points discussed and decided."),
      h(2, "Agreements"),
      table(
        ["Agreement", "Owner", "Due date", "Status"],
        [["What was agreed", "Name", "mm/dd/yyyy", "Pending"]],
      ),
      h(2, "Tasks"),
      tasks(["Task and owner", "Task and owner"]),
      h(2, "Next meeting"),
      p("Date, time and topics."),
    ),
  },
  {
    id: "welcome",
    name: "Welcome guide",
    title: "Welcome guide",
    description: "For people joining the team: first days, contacts and rules.",
    content: doc(
      NOTE,
      h(2, "Welcome aboard"),
      p("A few warm lines about the company and what to expect in the first weeks."),
      h(2, "Who we are"),
      p("What the company does, its values and how it's organized."),
      h(2, "Your first day"),
      tasks([
        "Get your workstation and accounts",
        "Meet the team and your manager",
        "Read the safety rules",
        "Sign any pending paperwork",
      ]),
      h(2, "Useful contacts"),
      table(
        ["For…", "Talk to", "Contact"],
        [
          ["Questions about your job", "Your manager", "Phone or email"],
          ["IT and accounts", "Support", "Phone or email"],
          ["Payroll and time off", "Human Resources", "Phone or email"],
        ],
      ),
      h(2, "Tools and accounts"),
      items("bulletList", ["Email and calendar", "This documentation platform"]),
      callout("warning", "Basic safety rules: list the essentials here."),
      h(2, "Your first weeks"),
      items("orderedList", [
        "Week 1: learn the processes",
        "Week 2: shadow a teammate",
        "Week 4: check-in",
      ]),
      h(2, "Frequently asked questions"),
      p("Where do I ask for help? How do I log my hours? Add the most common questions."),
    ),
  },
];
