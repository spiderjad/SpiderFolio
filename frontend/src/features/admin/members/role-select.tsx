// Selector de rol dentro de la fila de Miembros: cambia el rol al instante. Solo ofrece los roles
// que quien mira puede asignar; el servidor vuelve a validar (nadie da más de lo que tiene).
import { useMutation } from "@tanstack/react-query";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { adminApi, type MemberView } from "../api";
import { adminErrorText } from "../admin-utils";
import { texts } from "@/i18n";

export function RoleSelect({
  member,
  source,
  onChanged,
}: {
  member: MemberView;
  source: ComboboxSource;
  onChanged: () => Promise<unknown>;
}) {
  const { workspaceSlug = "" } = useParams();
  const change = useMutation({
    mutationFn: (roleId: string) => adminApi.updateMember(workspaceSlug, member.id, { roleId }),
    onSuccess: async () => {
      toast.success(texts.admin.common.saved);
      await onChanged();
    },
    onError: async (error) => {
      toast.error(adminErrorText(error));
      await onChanged();
    },
  });
  return (
    <Combobox
      className="h-9 w-44 min-w-0"
      searchable={false}
      label={texts.admin.members.roleOf(member.name)}
      placeholder={texts.admin.members.columns.role}
      source={source}
      value={member.roleId}
      valueLabel={member.roleName}
      disabled={change.isPending}
      onChange={(option) => {
        if (option !== null && option.id !== member.roleId) change.mutate(option.id);
      }}
    />
  );
}
