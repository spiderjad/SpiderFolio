# Pendientes y notas (actualizado 07/11/2026)

Lista viva. Al terminar algo, se marca o se borra de acá.

## Arquitectura: la app por áreas (analizar ANTES de sumar más módulos)

Pedido del mantenedor (07/11/2026): «la aplicación se va a descontrolar». Con Prevención (EPI, formación,
accidentes, CAE, planificación…), Calidad, documentos controlados y la wiki, el menú lateral ya confunde.
Hay que analizar y decidir con él, sin código todavía:

- **Áreas de primer nivel**: Prevención (PRL), Calidad, Documentación (documentos controlados,
  aprobaciones, lecturas, vencimientos) y Wiki (espacios y páginas), cada una con su propio menú interno,
  en vez de un menú plano con todo.
- **Cada departamento entra a su espacio**: que la portada y el menú de cada persona muestren primero lo
  de su departamento y sus áreas, y lo demás quede a un clic (selector de área, como cambiar de app).
- Qué áreas ve cada persona: según los módulos activos en la empresa, sus capacidades y su departamento;
  quién elige el área por defecto (la empresa por departamento, o cada persona).
- Cómo encajan lo transversal (buscador, Mis pendientes, notificaciones, Bian, Administración) y el móvil.
- Entregable: una propuesta corta con 2 o 3 opciones de navegación (boceto de menú por rol: operario,
  jefe de producción, técnico de PRL, calidad, admin) para elegir, y después el spec en docs/spec/diseno.md.
- **Propuesta lista** (07/11/2026): `docs/plans/navegacion/propuesta.html` (abrir en el navegador desde el
  repo; usa spider-ui del paquete instalado). Tres opciones (A selector, B barra de áreas, C portada por
  departamento) × cinco perfiles, escritorio y celular. **Elegida: B** (07/11/2026), con Wiki y Documentación separadas, formularios en su área y
  Administración como área de la barra. Spec en docs/spec/diseno.md, 10.4.1. **Implementada** (07/11/2026).
- [ ] **Capturas con el marco nuevo que faltan** (navegación por áreas): las de plugins, que necesitan los
      plugins compilados (`CAPTURAS_PLUGINS_DIR`) y las licencias (`CAPTURAS_LICENCIAS`): `plugin-microsoft`,
      `plugin-claude`, `aplicaciones-conectadas`, `conector-seguridad`, `autorizar-app`, `plugin-asistente`,
      `plugin-directorio` y `licencia`. `sala-auditor` (vista del auditor externo, sin el marco) no cambia.

## Módulos por hacer (núcleo, apagados por defecto y activables por empresa, como Seguridad y salud)

- [ ] **CAE (Coordinación de Actividades Empresariales, PRL)**: fases 1 a 6 hechas (07/11/2026). Núcleo, **dentro de
      Prevención** como pestaña «Contratas (CAE)», con su propio interruptor en la configuración del
      módulo (apagado por defecto). Spec y fases en `docs/spec/cae.md`.
  - [x] Tests de seguridad del portal de contratas (hechos al cerrar el módulo, 07/11/2026:
        `backend/tests/integration/cae-portal.test.ts` y `cae-security.test.ts`). Hallazgo corregido: las subidas del portal ya no dependen de que
        quien dio el acceso pueda editar el espacio del módulo (escriben como el sistema en la carpeta de la
        empresa), con los de permisos y
        aislamiento de la CAE): fuerza bruta del código (límites por acceso+IP y por IP, bloqueo a los 10
        fallos, error genérico igual para acceso inexistente, revocado, vencido o bloqueado); entre empresas
        (trabajadores, requisitos, subidas, permisos e información de otra contrata del mismo tenant dan
        404); entre tenants (un acceso o una cookie de un workspace no ven nada de otro); acceso revocado o
        vencido, empresa archivada, CAE o módulo apagados y quien lo dio suspendido o sin `cae.manage`:
        la sesión muere; tipo de archivo (extensión fuera de PDF/JPG/PNG, contenido que no coincide,
        tamaño mayor que el límite, completar una reserva ajena o de otro acceso); fijación y rotación de
        sesión (un token previo al código no sirve, rotación cada 15 min, logout termina la sesión,
        cookie con path del acceso); la información del centro solo sirve los documentos elegidos.
- [x] **Lo que le falte a Prevención**: fases 6 a 9 hechas (07/11/2026), en docs/spec/seguridad-salud.md.
- [ ] **Calidad alimentaria** (IFS 8 / BRCGS 9, cárnicas): notas, 14 bloques y orden en
      [2026-11-07-modulo-calidad.md](2026-11-07-modulo-calidad.md). Núcleo, **módulo aparte en el menú**,
      activable por empresa como Prevención. Spec [docs/spec/calidad.md](../spec/calidad.md) aprobada;
      **fases 1 a 5, 6a, 6b, 6c y 7a cerradas** (08/11/2026): no conformidades y CAPA; plan APPCC, PCC, plantilla
      cárnica y producto retenido; auditorías con su cobertura y hallazgos; proveedores con documentos,
      vencimientos y evaluación; reclamaciones, crisis y retirada; panel de indicadores y prerrequisitos;
      productos con su ficha, estudios de vida útil, aprobación de etiquetas y plan analítico; cultura de
      seguridad alimentaria con encuestas anónimas y gestión de cambios. Con sus tests de seguridad. Sigue
      la fase 7: la **7a** (lotes, enlaces, entregas, traza, CSV) está hecha (08/11/2026); la **7b** (plugin
      `erp-traceability` con SAP y ADA MES y el punto de extensión `ctx.traceability`) queda **en suspenso**
      (09/11/2026) hasta que la empresa responda sobre SAP y ADA MES (preguntas abiertas en calidad.md,
      «Fase 7»).

- [ ] **Canal de denuncias** (Ley 2/2023; pedido 09/11/2026, primero de los módulos nuevos): spec aprobada
      en [docs/spec/canal-denuncias.md](../spec/canal-denuncias.md). **Fase 1 hecha** (09/11/2026), falta
      que el mantenedor la pruebe, las capturas y la fase 2 (adjuntos, comunicaciones verbales,
      libro-registro exportable, supresión automática, cartel con QR, política y procedimiento al
      activar). Tests de seguridad al cerrar el módulo. La guía no se publica hasta la versión del núcleo. Después, en este orden: Mantenimiento (GMAO), Medio ambiente, Requisitos
      legales, Personas y polivalencia, Visitas.

- [ ] **Medio ambiente** (pedido 09/11/2026): spec aprobada en
      [docs/spec/medio-ambiente.md](../spec/medio-ambiente.md). **Fases 1 a 5 hechas** (autorizaciones y
      obligaciones; residuos y SANDACH con archivo cronológico; vertidos; consumos; gases fluorados y Resumen),
      falta que el mantenedor las pruebe y las capturas. Quedan los aspectos ambientales (si se piden) y el CO₂
      de la energía. Las guías no se publican hasta la versión del núcleo.

- [x] **Mantenimiento** (pedido 09/11/2026): **publicado en la v0.15.0** el 10/11/2026, probado por el
      mantenedor parte por parte, con su guía y capturas. Spec en
      [docs/spec/mantenimiento.md](../spec/mantenimiento.md): equipos con QR, OT, avisar y cerrar hablando
      (Whisper), sugerencia con IA, preventivo y calibración, enlace con Calidad, API del SGA e indicadores.
      Con la versión salió también el arreglo de carga (límite por persona, no por IP; `DATABASE_POOL_MAX`,
      `API_PROCESSES`), tras un simulacro con 200 usuarios.
- [ ] Mantenimiento, lo que queda: tests de seguridad del módulo (fase 7, cuando el mantenedor lo pida),
      punto de extensión para un plugin de SGA concreto, decidir el aviso sin cuenta desde el QR, y medir
      `API_PROCESSES` en el servidor real.

## Migración a spider-ui

- [x] Etapas 2 a 5 en [2026-11-07-spider-ui.md](2026-11-07-spider-ui.md) (08/11/2026): componentes `v-*`,
      acceso `auth-*`, web sin degradados y con títulos en Inter, capturas regeneradas. El panel usa el
      violeta de spider-ui (o el acento de la empresa) en el botón principal.
- [x] Reescribir los tests del preset (`packages/tailwind-preset/tests`) para los alias `var(--sp-*)` (07/11/2026).

## Plugins

- [ ] **Plantillas propias y por rubro** (`templates` 1.0.0, docs/spec/plantillas.md), hecho el 08/11/2026 sin
      probar con licencia: falta que el mantenedor lo pruebe en la instalación de prueba (licencia firmada
      para la empresa), los tests de seguridad al cerrar el módulo (plantillas de otra empresa 404, guardar
      solo lo que se ve, usar exige crear en el destino, invitados no, sin la feature 404, límites) y las
      capturas. Prueba en este PC con el dev local: licencia para «Demo Industrias»
      (`cmvf5f1at0001eodqye2xurc1`) con `entregas/licencia-plantillas.ps1`, porque el núcleo con
      plantillas aún no está en ninguna versión publicada (la instalación de prueba usa v0.13.0). Su guía (`plantillas` / `templates`) ya está en la web pero el catálogo lo muestra como
      «Próximamente» (`version: null`) hasta que el mantenedor lo pruebe. Paquetes solo en español.
- [ ] **Importación de OneDrive y SharePoint** (`onedrive-import`): esqueleto; spec primero. Necesita una
      app registrada en Microsoft Entra (la registra el mantenedor).
- [ ] **Documentos controlados** (pedido 08/11/2026): hechos el listado maestro (CSV y PDF con los filtros
      de la lista) y dar de baja sin reemplazo (motivo, última versión obsoleta, sin lecturas ni revisión;
      publicar una versión nueva lo reactiva). También los documentos externos (tipo EXT: emisor,
      referencia y edición, registrados como vigentes sin aprobación). Falta, opcional, el registro de
      copias impresas controladas. Tests de seguridad
      de ambos al cerrar el módulo.

- [x] **«Licencia y plugins» para el admin**: decidido y hecho (09/11/2026), el admin la ve en **solo
      lectura** (`GET /admin/license` con `workspace.settings`); cargar la licencia, subir, quitar o activar
      plugins y reiniciar siguen siendo del propietario. Guía y spec actualizadas; la guía de la web espera
      a la próxima versión del núcleo.
- [ ] Las licencias de `entregas/` (LIC-2026-0001 a 0004) son de la empresa `cmvrwab20000301p17i21oq4k`
      (instalación de prueba de Windows). En la Mac hay que firmar licencias nuevas para la empresa demo local
      `cmvf5f1at0001eodqye2xurc1` (demo-industrias); lo firma quien mantiene el proyecto. El repo privado de
      plugins todavía no está clonado en la Mac.

## Entorno de la Mac

- `npx prisma generate` en `backend/` después de clonar (el cliente no se versiona).
- `npm run lint` necesita `NODE_OPTIONS=--max-old-space-size=8192`.
- El puerto 5432 lo usa también `circulo-postgres` (otro proyecto): frenarlo antes de
  `docker compose up -d`. Si postgres arrancó sin puerto, `docker compose up -d --force-recreate postgres`.
- `.githooks/pre-commit` no es ejecutable: `chmod +x .githooks/pre-commit`.
- Los 49 archivos del backup del 27/10 no tienen contenido en RustFS (el backup es solo la base).
- Datos demo: `npm run db:seed` más un script de módulos (puestos, formularios, seguridad y salud,
  vencimientos, sala de auditoría) que quedó fuera del repo; pasarlo a `backend/prisma/` si se quiere
  conservar.
