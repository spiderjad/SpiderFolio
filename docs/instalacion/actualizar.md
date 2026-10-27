English version: [docs/install/upgrading.md](../install/upgrading.md)

# Actualizar SpiderFolio

Las versiones siguen [SemVer](https://semver.org/lang/es/). Antes de una versión mayor, lee las notas de
la versión (pueden pedir pasos manuales).

1. **Haz una copia** (siempre, antes de actualizar): `./backup.sh` (ver
   [copias-de-seguridad.md](copias-de-seguridad.md)).
2. **Baja la imagen nueva y reinicia**:

   ```sh
   cd spiderfolio/deploy
   git pull                     # trae compose.yaml y .env.example nuevos
   docker compose pull
   docker compose up -d
   docker compose logs -f app   # las migraciones corren solas; espera «API lista»
   ```

3. Compara `.env.example` con tu `.env`: una versión puede agregar variables (las obligatorias nuevas se
   indican en las notas; si falta alguna, la API no arranca y el log dice cuál).

Si compilas la imagen tú mismo (por ejemplo, con plugins): `docker compose build && docker compose up -d`.

## Si algo sale mal

- La API no arranca: `docker compose logs app`. Una migración fallida no deja la base a medias (cada
  una corre en una transacción); corrige la causa y vuelve a arrancar.
- Para volver a la versión anterior: fija `SPIDERFOLIO_IMAGE` a la etiqueta anterior **y restaura la
  copia** hecha en el paso 1 (las migraciones no se deshacen solas).
