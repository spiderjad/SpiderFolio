// Las personas de un departamento, en el "Organigrama": el jefe arriba, los subjefes y después los
// miembros, que se piden por cursor (scroll infinito). Cada persona aparece con su insignia de rol
// y, aparte, la de su cargo; el ámbar queda solo en la insignia, sin fondo en la fila. Las
// acciones (cargo y mover) van en el menú "..." de cada persona.
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Skeleton } from "@/components/ui/display";
import { adminApi, adminKeys, asPerson, type DepartmentBlock, type PersonData } from "../api";
import { MoreList, PersonActions, PersonRow, PREVIEW, type PersonActionHandlers } from "./people";
import { texts } from "@/i18n";

export function DepartmentPeople({
  block,
  handlers,
  memberFilter,
  highlightId,
}: {
  block: DepartmentBlock;
  handlers: PersonActionHandlers;
  /** Texto para mostrar solo a algunas personas del departamento (resultado de una búsqueda). */
  memberFilter?: string;
  /** Persona a resaltar (resultado de una búsqueda). */
  highlightId?: string;
}) {
  const t = texts.admin.members.byDepartment;
  const { workspaceSlug = "" } = useParams();
  const { department, head, deputies, members } = block;
  const ref = { id: department.id, name: department.name };

  const filtered = useQuery({
    queryKey: [
      ...adminKeys.department(workspaceSlug, department.id),
      "members-filter",
      memberFilter ?? "",
    ],
    queryFn: () =>
      adminApi.orgMembers(workspaceSlug, department.id, {
        q: memberFilter ?? "",
        pageSize: PREVIEW,
        positions: "members",
      }),
    enabled: memberFilter !== undefined,
  });

  const row = (member: PersonData) => (
    <PersonRow
      member={member}
      departmentId={department.id}
      highlight={member.id === highlightId}
      trailing={<PersonActions member={member} department={ref} handlers={handlers} />}
    />
  );
  const nobody = head === null && deputies.length === 0 && members.total === 0;
  const fetchMembers = async (cursor: string) =>
    await adminApi.orgMembers(workspaceSlug, department.id, {
      cursor,
      pageSize: PREVIEW,
      positions: "members",
      ...(memberFilter === undefined ? {} : { q: memberFilter }),
    });

  return (
    <div className="border-t border-border">
      {head === null ? (
        <p className="flex min-h-14 items-center px-4 text-xs text-muted-foreground sm:px-6">
          {t.noHead}
        </p>
      ) : (
        row(asPerson(head))
      )}
      {deputies.map((deputy) => (
        <div key={deputy.id} className="border-t border-border">
          {row(asPerson(deputy))}
        </div>
      ))}

      {nobody ? (
        <p className="border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6">
          {t.emptyBlock}
        </p>
      ) : memberFilter !== undefined ? (
        filtered.data === undefined ? (
          <Skeleton className="m-4 h-12" />
        ) : (
          <div className="border-t border-border">
            <MoreList
              key={memberFilter}
              initial={filtered.data.items}
              total={filtered.data.total}
              nextCursor={filtered.data.nextCursor}
              fetchPage={fetchMembers}
              renderRow={row}
            />
          </div>
        )
      ) : members.total > 0 ? (
        <div className="border-t border-border">
          <MoreList
            initial={members.items.map(asPerson)}
            total={members.total}
            nextCursor={members.nextCursor}
            fetchPage={fetchMembers}
            renderRow={row}
          />
        </div>
      ) : null}
    </div>
  );
}
