// /app/:slug/admin — lleva a la primera sección del panel que la persona puede usar.
import { Navigate } from "react-router";
import { navItems } from "@/components/nav-items";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useMembership } from "@/features/home/workspace-layout";
import { useActivePlugins } from "@/plugins/registry";

export function AdminIndex() {
  const membership = useMembership();
  const plugins = useActivePlugins(membership.workspace.slug);
  const first = navItems(membership.workspace.slug, membership, plugins).find(
    (item) => item.group !== undefined,
  );
  return first === undefined ? <NotFoundPage /> : <Navigate to={first.to} replace />;
}
