// SQL en crudo de los plugins (docs/spec/plugins.md): cada plugin trabaja solo en su esquema
// plugin_<id> y sus migraciones se registran en plugins.migrations. El nombre del esquema sale de un id
// validado (minúsculas, dígitos y guiones bajos), nunca de datos de un pedido.
import pg from "pg";
import type { PrismaClient } from "../../lib/prisma.ts";

const SCHEMA_NAME = /^plugin_[a-z][a-z0-9_]{1,39}$/u;

function assertSchema(schema: string): void {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Esquema de plugin inválido: ${schema}`);
}

/** Consulta parametrizada con search_path en el esquema del plugin (y nada más). */
export async function pluginQuery<T>(
  prisma: PrismaClient,
  schema: string,
  text: string,
  values: readonly unknown[],
): Promise<T[]> {
  assertSchema(schema);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    return tx.$queryRawUnsafe<T[]>(text, ...values);
  });
}

export interface PluginMigration {
  name: string;
  checksum: string;
  sql: string;
}

/**
 * Aplica las migraciones pendientes de un plugin en su esquema, cada una en su transacción y
 * registrada en plugins.migrations. Usa pg directo: una migración puede tener varias sentencias (el
 * protocolo simple de Postgres las acepta; las consultas preparadas, no).
 */
export async function applyPluginMigrations(
  connectionString: string,
  input: { pluginId: string; schema: string; migrations: readonly PluginMigration[] },
): Promise<{ applied: string[]; changed: string[] }> {
  assertSchema(input.schema);
  const client = new pg.Client({ connectionString, application_name: "spiderfolio-plugins" });
  await client.connect();
  try {
    // La API y el worker arrancan a la vez: uno aplica y el otro espera.
    await client.query("SELECT pg_advisory_lock(hashtext('spiderfolio-plugin-migrations'))");
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT "name", "checksum" FROM "plugins"."migrations" WHERE "pluginId" = $1',
      [input.pluginId],
    );
    const done = new Map(rows.map((row) => [row.name, row.checksum]));
    const applied: string[] = [];
    const changed: string[] = [];
    for (const migration of input.migrations) {
      const previous = done.get(migration.name);
      if (previous !== undefined) {
        // Una migración ya aplicada no se vuelve a correr aunque cambie: se avisa.
        if (previous !== migration.checksum) changed.push(migration.name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${input.schema}"`);
        await client.query(`SET LOCAL search_path TO "${input.schema}", public`);
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO "plugins"."migrations" ("pluginId", "name", "checksum") VALUES ($1, $2, $3)',
          [input.pluginId, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied.push(migration.name);
    }
    return { applied, changed };
  } finally {
    await client.end(); // al cerrar la conexión se libera el lock
  }
}
