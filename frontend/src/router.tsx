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
      // An audit room's external auditor: no account, with or without a member's session.
      {
        path: "auditoria/:roomId",
        lazy: page(() => import("@/features/audit-rooms/auditor-page"), "AuditorPage"),
      },
      // A contractor's portal (docs/spec/cae.md): no account, only its access's own cookie.
      {
        path: "contratas/:accessId",
        lazy: page(() => import("@/features/safety/cae-portal-page"), "CaePortalPage"),
      },
      // The whistleblowing channel (docs/spec/canal-denuncias.md): no account, nothing of the session.
      {
        path: "canal/:workspaceSlug",
        lazy: page(() => import("@/features/whistleblowing/channel-page"), "ChannelPage"),
      },
      {
        path: "canal/:workspaceSlug/buzon",
        lazy: page(() => import("@/features/whistleblowing/mailbox-page"), "MailboxPage"),
      },
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
                // «Mis pendientes» (docs/spec/diseno.md 10.4.1): what the person has to do, from every area.
                path: "pendientes",
                lazy: page(() => import("@/features/home/pending-page"), "PendingPage"),
              },
              {
                // File and page expiries (docs/spec/vencimientos.md): only what the person sees.
                path: "vencimientos",
                lazy: page(() => import("@/features/expiries/expiries-page"), "ExpiriesPage"),
              },
              {
                // Maintenance (docs/spec/mantenimiento.md): only while it's on.
                path: "mantenimiento",
                lazy: page(
                  () => import("@/features/maintenance/maintenance-common"),
                  "RequireMaintenance",
                ),
                children: [
                  {
                    index: true,
                    lazy: page(
                      () => import("@/features/maintenance/maintenance-common"),
                      "MaintenanceHome",
                    ),
                  },
                  {
                    path: "avisar",
                    lazy: page(() => import("@/features/maintenance/report-page"), "ReportPage"),
                  },
                  {
                    path: "ot",
                    lazy: page(
                      () => import("@/features/maintenance/work-orders-page"),
                      "WorkOrdersPage",
                    ),
                  },
                  {
                    path: "ot/:workOrderId",
                    lazy: page(
                      () => import("@/features/maintenance/work-order-page"),
                      "WorkOrderPage",
                    ),
                  },
                  {
                    path: "equipos",
                    lazy: page(() => import("@/features/maintenance/assets-page"), "AssetsPage"),
                  },
                  {
                    path: "preventivo",
                    lazy: page(() => import("@/features/maintenance/plans-page"), "PlansPage"),
                  },
                ],
              },
              {
                // Environment (docs/spec/medio-ambiente.md): only while it's on.
                path: "medio-ambiente",
                lazy: page(
                  () => import("@/features/environment/environment-common"),
                  "RequireEnvironment",
                ),
                children: [
                  {
                    index: true,
                    lazy: page(
                      () => import("@/features/environment/environment-common"),
                      "EnvironmentHome",
                    ),
                  },
                  {
                    path: "autorizaciones",
                    lazy: page(() => import("@/features/environment/permits-page"), "PermitsPage"),
                  },
                  {
                    path: "resumen",
                    lazy: page(
                      () => import("@/features/environment/summary-page"),
                      "EnvironmentSummaryPage",
                    ),
                  },
                  {
                    path: "residuos",
                    lazy: page(() => import("@/features/environment/waste-page"), "WastePage"),
                  },
                  {
                    path: "vertidos",
                    lazy: page(
                      () => import("@/features/environment/discharge-page"),
                      "DischargePage",
                    ),
                  },
                  {
                    path: "consumos",
                    lazy: page(
                      () => import("@/features/environment/consumption-page"),
                      "ConsumptionPage",
                    ),
                  },
                  {
                    path: "frio",
                    lazy: page(() => import("@/features/environment/cooling-page"), "CoolingPage"),
                  },
                ],
              },
              {
                // The whistleblowing channel's cases (docs/spec/canal-denuncias.md): its managers only.
                path: "canal",
                lazy: page(
                  () => import("@/features/whistleblowing/cases-page"),
                  "RequireChannelManager",
                ),
                children: [
                  {
                    index: true,
                    lazy: page(() => import("@/features/whistleblowing/cases-page"), "CasesPage"),
                  },
                  {
                    path: ":caseId",
                    lazy: page(() => import("@/features/whistleblowing/case-page"), "CasePage"),
                  },
                ],
              },
              {
                // Food quality (docs/spec/calidad.md): only while it's on.
                path: "calidad",
                lazy: page(() => import("@/features/quality/quality-common"), "RequireQuality"),
                children: [
                  {
                    index: true,
                    lazy: page(() => import("@/features/quality/quality-common"), "QualityHome"),
                  },
                  {
                    path: "resumen",
                    lazy: page(
                      () => import("@/features/quality/summary-page"),
                      "QualitySummaryPage",
                    ),
                  },
                  {
                    path: "no-conformidades",
                    lazy: page(() => import("@/features/quality/ncs-page"), "NcsPage"),
                  },
                  {
                    path: "no-conformidades/:ncId",
                    lazy: page(() => import("@/features/quality/nc-page"), "NcPage"),
                  },
                  {
                    path: "acciones",
                    lazy: page(
                      () => import("@/features/quality/actions-page"),
                      "QualityActionsPage",
                    ),
                  },
                  {
                    path: "appcc",
                    lazy: page(() => import("@/features/quality/haccp-page"), "HaccpPage"),
                  },
                  {
                    path: "retenido",
                    lazy: page(() => import("@/features/quality/holds-page"), "HoldsPage"),
                  },
                  {
                    path: "auditorias",
                    lazy: page(() => import("@/features/quality/audits-page"), "AuditsPage"),
                  },
                  {
                    path: "auditorias/:auditId",
                    lazy: page(() => import("@/features/quality/audit-page"), "AuditPage"),
                  },
                  {
                    path: "proveedores",
                    lazy: page(() => import("@/features/quality/suppliers-page"), "SuppliersPage"),
                  },
                  {
                    path: "proveedores/:supplierId",
                    lazy: page(() => import("@/features/quality/supplier-page"), "SupplierPage"),
                  },
                  {
                    path: "reclamaciones",
                    lazy: page(
                      () => import("@/features/quality/complaints-page"),
                      "ComplaintsPage",
                    ),
                  },
                  {
                    path: "reclamaciones/:complaintId",
                    lazy: page(() => import("@/features/quality/complaint-page"), "ComplaintPage"),
                  },
                  {
                    path: "crisis",
                    lazy: page(() => import("@/features/quality/crisis-page"), "CrisisPage"),
                  },
                  {
                    path: "prerrequisitos",
                    lazy: page(() => import("@/features/quality/prps-page"), "PrpsPage"),
                  },
                  {
                    path: "plan-analitico",
                    lazy: page(() => import("@/features/quality/sampling-page"), "SamplingPage"),
                  },
                  {
                    path: "productos",
                    lazy: page(() => import("@/features/quality/products-page"), "ProductsPage"),
                  },
                  {
                    path: "productos/:productId",
                    lazy: page(() => import("@/features/quality/product-page"), "ProductPage"),
                  },
                  {
                    path: "cultura",
                    lazy: page(() => import("@/features/quality/culture-page"), "CulturePage"),
                  },
                  {
                    path: "encuestas/:surveyId",
                    lazy: page(
                      () => import("@/features/quality/survey-answer-page"),
                      "SurveyAnswerPage",
                    ),
                  },
                  {
                    path: "cambios",
                    lazy: page(() => import("@/features/quality/changes-page"), "ChangesPage"),
                  },
                  {
                    path: "cambios/:changeId",
                    lazy: page(() => import("@/features/quality/change-page"), "ChangePage"),
                  },
                  {
                    path: "trazabilidad",
                    lazy: page(
                      () => import("@/features/quality/traceability-page"),
                      "TraceabilityPage",
                    ),
                  },
                  {
                    path: "trazabilidad/:lotId",
                    lazy: page(() => import("@/features/quality/lot-page"), "LotPage"),
                  },
                  {
                    path: "mis-acciones",
                    lazy: page(
                      () => import("@/features/quality/actions-page"),
                      "MyQualityActionsPage",
                    ),
                  },
                  {
                    path: "comunicadas",
                    lazy: page(() => import("@/features/quality/ncs-page"), "ReportedNcsPage"),
                  },
                  {
                    path: "comunicar",
                    lazy: page(() => import("@/features/quality/report-page"), "ReportNcPage"),
                  },
                ],
              },
              {
                // Occupational health and safety (docs/spec/seguridad-salud.md): only while it's on.
                path: "seguridad",
                lazy: page(() => import("@/features/safety/safety-common"), "RequireSafety"),
                children: [
                  {
                    index: true,
                    lazy: page(() => import("@/features/safety/safety-common"), "SafetyHome"),
                  },
                  {
                    path: "epis",
                    lazy: page(() => import("@/features/safety/deliveries-page"), "DeliveriesPage"),
                  },
                  {
                    // Each attendee signs in-person training on their own phone (QR or link).
                    path: "firmar/:sessionId",
                    lazy: page(() => import("@/features/safety/sign-session"), "SignSessionPage"),
                  },
                  {
                    lazy: page(
                      () => import("@/features/safety/safety-common"),
                      "RequireSafetyManager",
                    ),
                    children: [
                      {
                        // The planning of the preventive activity (docs/spec/seguridad-salud.md).
                        path: "planificacion",
                        lazy: page(() => import("@/features/safety/planning-page"), "PlanningPage"),
                      },
                      {
                        // Emergency plan, team and drills (docs/spec/seguridad-salud.md).
                        path: "emergencias",
                        lazy: page(
                          () => import("@/features/safety/emergencies-page"),
                          "EmergenciesPage",
                        ),
                      },
                      {
                        path: "emergencias/simulacros",
                        lazy: page(() => import("@/features/safety/drills-page"), "DrillsPage"),
                      },
                      {
                        path: "emergencias/simulacros/:drillId",
                        lazy: page(() => import("@/features/safety/drill-page"), "DrillPage"),
                      },
                      {
                        path: "epis/catalogo",
                        lazy: page(() => import("@/features/safety/catalog-page"), "CatalogPage"),
                      },
                      {
                        path: "epis/nueva",
                        lazy: page(
                          () => import("@/features/safety/new-delivery-page"),
                          "NewDeliveryPage",
                        ),
                      },
                    ],
                  },
                  {
                    path: "epis/:deliveryId",
                    lazy: page(() => import("@/features/safety/delivery-page"), "DeliveryPage"),
                  },
                  {
                    path: "formacion",
                    lazy: page(() => import("@/features/safety/training-page"), "TrainingPage"),
                  },
                  {
                    path: "formacion/:courseId",
                    lazy: page(() => import("@/features/safety/course-page"), "CoursePage"),
                  },
                  {
                    path: "medidas",
                    lazy: page(() => import("@/features/safety/my-actions-page"), "MyActionsPage"),
                  },
                  {
                    lazy: page(
                      () => import("@/features/safety/safety-common"),
                      "RequireSafetyHealth",
                    ),
                    children: [
                      {
                        path: "incidentes",
                        lazy: page(
                          () => import("@/features/safety/incidents-page"),
                          "IncidentsPage",
                        ),
                      },
                      {
                        path: "incidentes/:incidentId",
                        lazy: page(() => import("@/features/safety/incident-page"), "IncidentPage"),
                      },
                    ],
                  },
                  {
                    // The health and safety committee: safety.manage, or its members (read only).
                    path: "comite",
                    lazy: page(() => import("@/features/safety/safety-common"), "RequireCommittee"),
                    children: [
                      {
                        index: true,
                        lazy: page(
                          () => import("@/features/safety/committee-page"),
                          "CommitteePage",
                        ),
                      },
                      {
                        path: "reuniones",
                        lazy: page(() => import("@/features/safety/meetings-page"), "MeetingsPage"),
                      },
                      {
                        path: "reuniones/:meetingId",
                        lazy: page(() => import("@/features/safety/meeting-page"), "MeetingPage"),
                      },
                    ],
                  },
                  {
                    // Accident rates (safety.manage or safety.health; the page and the API check).
                    path: "indicadores",
                    lazy: page(() => import("@/features/safety/indicators-page"), "IndicatorsPage"),
                  },
                  {
                    path: "comunicar",
                    lazy: page(() => import("@/features/safety/report-page"), "ReportPage"),
                  },
                  {
                    path: "resumen",
                    lazy: page(() => import("@/features/safety/summary-page"), "SummaryPage"),
                  },
                  {
                    path: "personas",
                    lazy: page(() => import("@/features/safety/people-page"), "PeoplePage"),
                  },
                  {
                    path: "personas/:membershipId",
                    lazy: page(() => import("@/features/safety/person-page"), "PersonPage"),
                  },
                  {
                    // CAE (docs/spec/cae.md): only while it's on, for whoever manages or checks it.
                    path: "cae",
                    lazy: page(() => import("@/features/safety/cae-common"), "RequireCae"),
                    children: [
                      {
                        index: true,
                        lazy: page(
                          () => import("@/features/safety/cae-companies-page"),
                          "CaeCompaniesPage",
                        ),
                      },
                      {
                        path: "empresas/:companyId",
                        lazy: page(
                          () => import("@/features/safety/cae-company-page"),
                          "CaeCompanyPage",
                        ),
                      },
                      {
                        path: "porteria",
                        lazy: page(() => import("@/features/safety/cae-gate-page"), "CaeGatePage"),
                      },
                      {
                        path: "permisos",
                        lazy: page(
                          () => import("@/features/safety/cae-permits-page"),
                          "CaePermitsPage",
                        ),
                      },
                      {
                        path: "permisos/:permitId",
                        lazy: page(
                          () => import("@/features/safety/cae-permit-page"),
                          "CaePermitPage",
                        ),
                      },
                      {
                        path: "accesos",
                        lazy: page(
                          () => import("@/features/safety/cae-accesses-page"),
                          "CaeAccessesPage",
                        ),
                      },
                      {
                        path: "trabajadores/:workerId",
                        lazy: page(
                          () => import("@/features/safety/cae-worker-page"),
                          "CaeWorkerPage",
                        ),
                      },
                      {
                        lazy: page(
                          () => import("@/features/safety/cae-common"),
                          "RequireCaeManager",
                        ),
                        children: [
                          {
                            path: "revisar",
                            lazy: page(
                              () => import("@/features/safety/cae-review-page"),
                              "CaeReviewPage",
                            ),
                          },
                          {
                            path: "catalogo",
                            lazy: page(
                              () => import("@/features/safety/cae-catalog-page"),
                              "CaeCatalogPage",
                            ),
                          },
                        ],
                      },
                    ],
                  },
                ],
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
                    path: ":spaceId/form/:formId",
                    lazy: page(() => import("@/features/forms/form-editor-page"), "FormEditorPage"),
                  },
                  {
                    path: ":spaceId/form/:formId/fill",
                    lazy: page(() => import("@/features/forms/form-fill-page"), "FormFillPage"),
                  },
                  {
                    path: ":spaceId/form/:formId/r/:recordId",
                    lazy: page(() => import("@/features/forms/records"), "RecordPage"),
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
                    lazy: page(() => import("@/features/admin/guards"), "RequirePositions"),
                    children: [
                      {
                        path: "positions",
                        lazy: page(
                          () => import("@/features/admin/positions/positions-page"),
                          "PositionsPage",
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
                    // Audit rooms (docs/spec/salas-de-auditoria.md): audit.share.
                    lazy: page(() => import("@/features/admin/guards"), "RequireAuditRooms"),
                    children: [
                      {
                        path: "audit-rooms",
                        lazy: page(() => import("@/features/audit-rooms/rooms-page"), "RoomsPage"),
                      },
                      {
                        path: "audit-rooms/:roomId",
                        lazy: page(() => import("@/features/audit-rooms/room-page"), "RoomPage"),
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
