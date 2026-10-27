# Excepciones de `npm audit`

Regla (CLAUDE.md, sección 12): `npm audit --omit=dev` sin vulnerabilidades altas antes de cada
despliegue. Las vulnerabilidades de dependencias de desarrollo se revisan y se anotan acá con su
motivo. Esta lista se revisa al cerrar cada módulo: si hay versión corregida, se actualiza y se
borra la entrada.

| Paquete                          | Advisory                                                                                                                             | Severidad | Llega por                                                     | Alcance                                                                                            | Motivo                                                                                                                                                                                                              | Anotada    | Revisar        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------- |
| `postcss-selector-parser` 6.0.10 | [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) (complejidad cuadrática al parsear selectores, CWE-400/407) | Moderada  | `@tailwindcss/typography` 0.5.20, que fija esa versión exacta | Solo build: devDependency del preset, de la app y de la web; no llega a las imágenes de producción | Los selectores que procesa son los de nuestro CSS y del propio plugin, no entrada de usuarios. La corrección (7.1.6) es un salto de versión mayor que typography no adoptó, y decidimos no forzarla con `overrides` | 2026-10-19 | En cada módulo |
| `@tailwindcss/typography` 0.5.20 | Mismo advisory (depende de la versión vulnerable)                                                                                    | Moderada  | devDependency directa del preset                              | Solo build                                                                                         | Misma entrada de arriba; desaparece cuando typography actualice su dependencia                                                                                                                                      | 2026-10-19 | En cada módulo |

## Producción

Sin excepciones. Las dos moderadas de `react-router` 6.30.6 (GHSA-wrjc-x8rr-h8h6 y
GHSA-337j-9hxr-rhxg) se cerraron el 2026-10-19 al pasar a React Router 7.18.4. `safeNext` sigue
validando el `?next=` del login como defensa propia.

Último `npm audit` completo: 2026-10-19, 2 moderadas (las 2 de build de arriba), 0 altas.
`npm audit --omit=dev`: 0 vulnerabilidades. Las 10 advisories de Astro 5 (críticas y altas, hasta
`astro <= 7.2.7`) dejaron de aplicar al subir a Astro 7.4.1 (2026-10-19).
