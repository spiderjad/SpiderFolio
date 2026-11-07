# Pendientes y notas (actualizado 07/11/2026)

Lista viva. Al terminar algo, se marca o se borra de acá.

## Módulos por hacer (núcleo, apagados por defecto y activables por empresa, como Seguridad y salud)

- [ ] **CAE (Coordinación de Actividades Empresariales, PRL)**: fases 1 a 4 y 6 hechas (07/11/2026). Núcleo, **dentro de
      Prevención** como pestaña «Contratas (CAE)», con su propio interruptor en la configuración del
      módulo (apagado por defecto). Spec y fases en `docs/spec/cae.md`.
  - [ ] Fase 5 (portal de contratas): en espera de que el mantenedor elija el tipo de acceso externo.
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
