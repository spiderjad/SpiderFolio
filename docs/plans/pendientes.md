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
  departamento) × cinco perfiles, escritorio y celular. Recomendada: B. Falta que el mantenedor elija.

## Módulos por hacer (núcleo, apagados por defecto y activables por empresa, como Seguridad y salud)

- [ ] **CAE (Coordinación de Actividades Empresariales, PRL)**: fases 1 a 6 hechas (07/11/2026). Núcleo, **dentro de
      Prevención** como pestaña «Contratas (CAE)», con su propio interruptor en la configuración del
      módulo (apagado por defecto). Spec y fases en `docs/spec/cae.md`.
  - [ ] Tests de seguridad del portal de contratas (al cerrar el módulo, con los de permisos y
        aislamiento de la CAE): fuerza bruta del código (límites por acceso+IP y por IP, bloqueo a los 10
        fallos, error genérico igual para acceso inexistente, revocado, vencido o bloqueado); entre empresas
        (trabajadores, requisitos, subidas, permisos e información de otra contrata del mismo tenant dan
        404); entre tenants (un acceso o una cookie de un workspace no ven nada de otro); acceso revocado o
        vencido, empresa archivada, CAE o módulo apagados y quien lo dio suspendido o sin `cae.manage`:
        la sesión muere; tipo de archivo (extensión fuera de PDF/JPG/PNG, contenido que no coincide,
        tamaño mayor que el límite, completar una reserva ajena o de otro acceso); fijación y rotación de
        sesión (un token previo al código no sirve, rotación cada 15 min, logout termina la sesión,
        cookie con path del acceso); la información del centro solo sirve los documentos elegidos.
- [ ] **Lo que le falte a Prevención**: relevarlo y sumarlo como fases nuevas en
      docs/spec/seguridad-salud.md (pedido del 07/11/2026).
- [ ] **Calidad alimentaria** (IFS 8 / BRCGS 9, cárnicas): notas, 14 bloques y orden en
      [2026-11-07-modulo-calidad.md](2026-11-07-modulo-calidad.md). Núcleo, **módulo aparte en el menú**,
      activable por empresa como Prevención. Primero el spec `docs/spec/calidad.md`.

## Migración a spider-ui

- [ ] Etapas 2 a 5 en [2026-11-07-spider-ui.md](2026-11-07-spider-ui.md) (componentes `v-*`, acceso
      `auth-*`, web, guías y capturas). El panel usa el violeta de spider-ui, no el monocromo de su guía.
- [ ] Reescribir los tests del preset (`packages/tailwind-preset/tests`) para los alias `var(--sp-*)`.

## Plugins

- [ ] **«Licencia y plugins» (subir plugins) no aparece en el menú** para el admin: hoy solo lo ve la
      dueña (`frontend/src/components/nav-items.ts`, `section === "license"` → `OWNER`), y subir exige 2FA
      reciente de la dueña. Decidir si el admin lo ve en solo lectura o si se deja así y se explica en la guía.
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
