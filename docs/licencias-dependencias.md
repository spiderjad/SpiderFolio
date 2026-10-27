# Licencias de las dependencias

Generado con `node scripts/check-licenses.ts --report docs/licencias-dependencias.md` a partir de package-lock.json.
Total: 1095 paquetes. El proyecto es AGPLv3.

## Por licencia

| Licencia | Paquetes |
|---|---|
| MIT | 854 |
| Apache-2.0 | 89 |
| ISC | 52 |
| MPL-2.0 | 24 |
| BSD-2-Clause | 21 |
| BSD-3-Clause | 12 |
| LGPL-3.0-or-later | 10 |
| BlueOak-1.0.0 | 7 |
| MIT-0 | 3 |
| OFL-1.1 | 3 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Unlicense | 3 |
| CC0-1.0 | 2 |
| 0BSD | 2 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| MIT and ISC | 1 |
| Python-2.0 | 1 |
| BSD | 1 |
| EPL-2.0 | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| (MIT AND Zlib) | 1 |
| FSL-1.1-Apache-2.0 | 1 |
| (MIT OR CC0-1.0) | 1 |
| MIT AND ISC | 1 |

## Para revisar

- duck: BSD permisiva (dependencia de mammoth) (revisada a mano)
- elkjs: EPL-2.0, solo en Prisma Studio (herramienta de la CLI de Prisma) (revisada a mano)
- sentry: FSL-1.1-Apache-2.0, dependencia de @sentry/node (bundler-plugins); revisar si se quita Sentry (revisada a mano)

Sin otras: el resto es compatible con la AGPLv3.
