# Límites de la empresa

SpiderFolio es open source y cada instalación paga su propia infraestructura (almacenamiento, email y la
API de Anthropic para Bian). No hay planes, precios, prueba ni modo de solo lectura por suscripción.

## Por defecto, sin límites

Cada empresa (workspace) guarda sus límites en `Workspace.limits` (JSON validado con
`StoredLimitsSchema` de `@spiderfolio/limits`). Lo que no está fijado es ilimitado.

| Clave | Qué limita | Unidad | Mínimo al fijarlo |
|---|---|---|---|
| `storageGb` | Almacenamiento total del workspace | GB (1024³ bytes) | 0 |
| `maxFileMb` | Tamaño de un archivo | MB (1024² bytes) | 1 |
| `fileVersionsKept` | Versiones guardadas de cada archivo común (la vigente y las de documentos controlados nunca se tocan) | versiones | 1 |
| `auditRetentionDays` | Días que se conserva el registro de auditoría | días | 30 |
| `aiQueriesPerMonth` | Consultas a Bian por mes calendario (UTC) de toda la empresa | consultas | 0 |

- Se ven en Administración › Límites y uso (`workspace.settings` o `storage.view`) y se cambian con
  `workspace.settings` (`PATCH /admin/limits`, auditado como `limits.update`).
- El total mensual de Bian también se fija en Administración › Bian (`PUT /admin/bian/total`). Los
  límites por persona y departamento (`BianLimit`) siguen igual, siempre dentro del total.
- Al llegar a un límite: `LIMIT_REACHED` con `details: { limit, used, max }` (bytes o unidades).
- El código nunca escribe valores de límites (regla de ESLint); las claves y las unidades salen de
  `@spiderfolio/limits`, igual que `checkLimit` y `usageLevel`.

## Plazas

Las plazas completas y de lector siguen existiendo como tipo de membresía (los lectores de planta),
pero no tienen máximo: solo se cuentan.

## Lo que se quitó

Catálogo de precios (`packages/plans`), `Subscription`, `PlanCatalogVersion`, prueba de 14 días y su job,
solo lectura por suscripción (`SUBSCRIPTION_READ_ONLY`), funciones por plan (`FEATURE_NOT_IN_PLAN`),
consultas extra de Bian (`AiQueryBonus`), pedidos al equipo (`StaffRequest`), la capacidad
`billing.manage` y las variables de Stripe. Migración `20261118100000_remove_billing` (irreversible).
Las funciones que antes eran de plan (exportar evidencia, roles personalizados, accesos temporales, QR
público, remitente de email propio) son del núcleo. Las comerciales son plugins (docs/spec/plugins.md).
