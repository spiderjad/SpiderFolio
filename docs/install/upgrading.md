Versión en español: [docs/instalacion/actualizar.md](../instalacion/actualizar.md)

# Upgrade SpiderFolio

Versions follow [SemVer](https://semver.org/). Before a major version, read the release notes (they may
require manual steps).

1. **Make a backup** (always, before upgrading): `./backup.sh` (see [backups.md](backups.md)).
2. **Pull the new image and restart**:

   ```sh
   cd spiderfolio/deploy
   git pull                     # brings the new compose.yaml and .env.example
   docker compose pull
   docker compose up -d
   docker compose logs -f app   # migrations run automatically; wait for "API lista"
   ```

3. Compare `.env.example` with your `.env`: a version may add variables (new required ones are listed in
   the release notes; if one is missing, the API does not start and the log says which).

If you build the image yourself (for example, with plugins): `docker compose build && docker compose up -d`.

## If something goes wrong

- The API does not start: `docker compose logs app`. A failed migration does not leave the database
  half-done (each one runs in a transaction); fix the cause and start again.
- To go back to the previous version: set `SPIDERFOLIO_IMAGE` to the previous tag **and restore the
  backup** made in step 1 (migrations are not rolled back automatically).
