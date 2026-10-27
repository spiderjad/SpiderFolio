// Listas cerradas y chicas por definición (plaza, estados, tipos…) para el Combobox: opciones fijas
// que se filtran en el cliente. Todo lo que pueda crecer usa una fuente del servidor (sources.ts).
import type { ComboOption } from "@/components/ui/combobox";
import { texts } from "@/i18n";

/** "auto" representa la plaza elegida por el sistema según el rol (valor vacío en la API). */
export const SEAT_AUTO = "auto";

export const seatChoices: ComboOption[] = [
  { id: SEAT_AUTO, label: texts.admin.invitations.dialog.seatAuto },
  { id: "FULL", label: texts.admin.members.seat.FULL },
  { id: "READER", label: texts.admin.members.seat.READER },
];

export const seatOnlyChoices: ComboOption[] = seatChoices.slice(1);

export const departmentModeChoices: ComboOption[] = (["add", "remove", "set"] as const).map(
  (id) => ({ id, label: texts.admin.members.bulk.departmentMode[id] }),
);

export const memberStatusChoices: ComboOption[] = [
  { id: "ACTIVE", label: texts.admin.members.status.ACTIVE },
  { id: "SUSPENDED", label: texts.admin.members.status.SUSPENDED },
];

export const invitationStatusChoices: ComboOption[] = [
  { id: "pending", label: texts.admin.invitations.statuses.pending },
  { id: "expired", label: texts.admin.invitations.statuses.expired },
];

export const roleKindChoices: ComboOption[] = [
  { id: "system", label: texts.admin.roles.filters.system },
  { id: "custom", label: texts.admin.roles.filters.custom },
];

export const idleChoices: ComboOption[] = ([1, 2, 3, 5, 10, 15, 20, 30] as const).map(
  (minutes) => ({ id: String(minutes), label: texts.admin.pin.settings.minutes(minutes) }),
);

export const visibilityChoices: ComboOption[] = [
  { id: "company", label: texts.admin.security.visibility.company },
  { id: "department", label: texts.admin.security.visibility.department },
];

export const smtpSecurityChoices: ComboOption[] = (["STARTTLS", "TLS"] as const).map((id) => ({
  id,
  label: texts.admin.security.email.security[id],
}));

export const smtpPortChoices: ComboOption[] = [587, 465, 2525, 25].map((port) => ({
  id: String(port),
  label: String(port),
}));
