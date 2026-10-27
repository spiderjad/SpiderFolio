// Texto de los motivos de acceso («por qué puede entrar»), compartido por «Compartir» y la auditoría.
import { formatShortDate } from "@/lib/utils";
import type { Reason, ReasonView } from "./api";
import { texts } from "@/i18n";

export function reasonText(reason: Reason, departmentName: string | null): string {
  const t = texts.sharing.reasons;
  const dept = departmentName ?? "";
  switch (reason.kind) {
    case "owner":
      return t.owner;
    case "admin":
      return t.admin;
    case "bypass":
      return t.bypass;
    case "company":
      return t.company;
    case "leader":
      return reason.rank === "HEAD" ? t.leaderHead(dept) : t.leaderDeputy(dept);
    case "member":
      return reason.subareas ? t.memberSubareas(dept) : t.member(dept);
    case "visible":
      return t.visible(dept);
    case "grant":
      if (reason.via === "company") return t.grantCompany;
      return reason.via === "department" ? t.grantDepartment(dept) : t.grantPerson;
  }
}

export function reasonLine(view: ReasonView): string {
  const t = texts.sharing.reasons;
  const parts = [reasonText(view.reason, view.departmentName)];
  const expiresAt = view.reason.kind === "grant" ? view.reason.expiresAt : null;
  if (expiresAt !== null && expiresAt !== undefined) {
    parts.push(t.expires(formatShortDate(expiresAt)));
  }
  if (view.from !== null) parts.push(t.inheritedFrom(view.from.name));
  return parts.join(" ");
}
