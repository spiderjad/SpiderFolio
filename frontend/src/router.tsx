import { useEffect, type ComponentType } from "react";
import { Toaster } from "sonner";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AuthProvider } from "@/auth/auth-context";
import { GuestOnly, RequireAuth, Splash } from "@/auth/guards";
import { clearReloadMark, RouteError } from "@/components/route-error";
import { TooltipProvider } from "@/components/ui/overlay";

function Root() {
  // La app cargó bien: se quita la marca de "recargado una vez" de la URL.
  useEffect(() => {
    clearReloadMark();
  }, []);
  return (
    <AuthProvider>
      <TooltipProvider>
        <Outlet />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </AuthProvider>
  );
}

/**
 * Carga diferida por ruta: cada pantalla es su propio chunk y se descarga al entrar. Recharts,
 * por ejemplo, solo viaja con el inicio. Las guardas y el proveedor de auth son el núcleo y van
 * en el bundle principal.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return async () => ({ Component: (await load())[name] });
}

export const routes = [
  {
    element: <Root />,
    errorElement: <RouteError />,
    // Mientras se descarga la primera pantalla.
    HydrateFallback: Splash,
    children: [
      { index: true, element: <Navigate to="/app" replace /> },
      // Lo que abre un código QR escaneado: con o sin sesión, según el código.
      { path: "q/:token", lazy: page(() => import("@/features/qr/scan-page"), "ScanPage") },
      {
        element: <GuestOnly />,
        children: [
          { path: "login", lazy: page(() => import("@/features/auth/login-page"), "LoginPage") },
          {
            // A company's sign-in screen: also offers its directory (work account).
            path: "login/:workspaceSlug",
            lazy: page(() => import("@/features/auth/login-page"), "LoginPage"),
          },
          {
            path: "register",
            lazy: page(() => import("@/features/auth/register-page"), "RegisterPage"),
          },
          {
            // Tablets compartidas: lectores de planta con usuario + PIN (7.6).
            path: "entrar",
            lazy: page(() => import("@/features/auth/pin-login-page"), "PinEntryRedirect"),
          },
          {
            path: "entrar/:workspaceSlug",
            lazy: page(() => import("@/features/auth/pin-login-page"), "PinLoginPage"),
          },
        ],
      },
      {
        path: "verify-email",
        lazy: page(() => import("@/features/auth/verify-email-page"), "VerifyEmailPage"),
      },
      {
        // Invitaciones: con sesión o sin ella; el token viaja en el fragmento.
        path: "accept-invite",
        lazy: page(() => import("@/features/auth/accept-invite-page"), "AcceptInvitePage"),
      },
      {
        // The connector for Claude's consent screen (the request travels in the fragment).
        path: "authorize-app",
        lazy: page(() => import("@/features/connector/authorize-app-page"), "AuthorizeAppPage"),
      },
      {
        path: "forgot-password",
        lazy: page(() => import("@/features/auth/password-pages"), "ForgotPasswordPage"),
      },
      {
        path: "reset-password",
        lazy: page(() => import("@/features/auth/password-pages"), "ResetPasswordPage"),
      },
      {
        // Backoffice del equipo de SpiderFolio: para el resto de la gente no existe (404).
        path: "internal",
        element: <RequireAuth />,
        children: [
          {
            lazy: page(() => import("@/features/internal/internal-page"), "RequireStaff"),
            children: [
              {
                index: true,
                lazy: page(() => import("@/features/internal/internal-page"), "InternalPage"),
              },
            ],
          },
        ],
      },
      {
        path: "app",
        element: <RequireAuth />,
        children: [
          {
            index: true,
            lazy: page(() => import("@/features/home/workspace-layout"), "AppIndex"),
          },
          {
            path: ":workspaceSlug",
            lazy: page(() => import("@/features/home/workspace-layout"), "WorkspaceLayout"),
            children: [
              {
                index: true,
                lazy: page(() => import("@/features/home/dashboard-page"), "DashboardPage"),
              },
              {
                path: "mis-documentos",
                lazy: page(
                  () => import("@/features/documents/my-documents-page"),
                  "MyDocumentsPage",
                ),
              },
              {
                path: "search",
                lazy: page(() => import("@/features/search/search-page"), "SearchPage"),
              },
              {
                path: "aprobaciones",
                lazy: page(() => import("@/features/documents/approvals-page"), "ApprovalsPage"),
              },
              {
                path: "profile",
                lazy: page(() => import("@/features/profile/profile-page"), "ProfilePage"),
              },
              {
                // Pantallas de los plugins activos (docs/spec/plugins.md).
                path: "p/:pluginId/*",
                lazy: page(() => import("@/plugins/plugin-pages"), "PluginScreenPage"),
              },
              {
                path: "files",
                children: [
                  {
                    index: true,
                    lazy: page(() => import("@/features/files/spaces-page"), "SpacesPage"),
                  },
                  {
                    path: "shared",
                    lazy: page(() => import("@/features/files/shared-page"), "SharedPage"),
                  },
                  {
                    path: ":spaceId",
                    lazy: page(() => import("@/features/files/explorer-page"), "ExplorerPage"),
                  },
                  {
                    path: ":spaceId/p/:pageId",
                    lazy: page(() => import("@/features/pages/page-editor-page"), "PageEditorPage"),
                  },
                  {
                    path: ":spaceId/trash",
                    lazy: page(() => import("@/features/files/trash-page"), "TrashPage"),
                  },
                  {
                    path: ":spaceId/f/:folderId",
                    lazy: page(() => import("@/features/files/explorer-page"), "ExplorerPage"),
                  },
                ],
              },
              {
                path: "admin",
                lazy: page(() => import("@/features/admin/admin-layout"), "AdminLayout"),
                children: [
                  {
                    index: true,
                    lazy: page(() => import("@/features/admin/admin-index"), "AdminIndex"),
                  },
                  {
                    // Secciones del panel que agregan los plugins activos.
                    path: "p/:pluginId/:section/*",
                    lazy: page(() => import("@/plugins/plugin-pages"), "PluginAdminPage"),
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireMembers"),
                    children: [
                      {
                        path: "members",
                        lazy: page(
                          () => import("@/features/admin/members/members-page"),
                          "MembersPage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireDepartments"),
                    children: [
                      {
                        path: "departments",
                        lazy: page(
                          () => import("@/features/admin/departments/department-workspace"),
                          "DepartmentsPage",
                        ),
                      },
                      {
                        path: "departments/:id",
                        lazy: page(
                          () => import("@/features/admin/departments/department-workspace"),
                          "DepartmentsPage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireSecurity"),
                    children: [
                      {
                        path: "security",
                        lazy: page(
                          () => import("@/features/admin/security/security-page"),
                          "SecurityPage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireAudit"),
                    children: [
                      {
                        path: "audit",
                        lazy: page(() => import("@/features/admin/audit/audit-page"), "AuditPage"),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireLicense"),
                    children: [
                      {
                        path: "license",
                        lazy: page(
                          () => import("@/features/admin/license/license-page"),
                          "LicensePage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireLimits"),
                    children: [
                      {
                        path: "limits",
                        lazy: page(
                          () => import("@/features/admin/license/limits-page"),
                          "LimitsPage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireBian"),
                    children: [
                      {
                        path: "bian",
                        lazy: page(
                          () => import("@/features/admin/bian/bian-admin-page"),
                          "BianAdminPage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireDocuments"),
                    children: [
                      {
                        path: "documents",
                        lazy: page(
                          () => import("@/features/documents/documents-admin-page"),
                          "DocumentsAdminPage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireAccess"),
                    children: [
                      {
                        path: "access",
                        lazy: page(
                          () => import("@/features/admin/access/access-page"),
                          "AccessPage",
                        ),
                      },
                    ],
                  },
                  {
                    lazy: page(() => import("@/features/admin/guards"), "RequireRoles"),
                    children: [
                      {
                        path: "roles",
                        lazy: page(() => import("@/features/admin/roles/roles-page"), "RolesPage"),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        path: "*",
        lazy: page(() => import("@/features/home/not-found-page"), "NotFoundPage"),
      },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
