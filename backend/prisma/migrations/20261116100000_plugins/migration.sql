-- CreateTable
CREATE TABLE "WorkspaceLicense" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceLicense_workspaceId_key" ON "WorkspaceLicense"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginSetting_workspaceId_pluginId_key_key" ON "PluginSetting"("workspaceId", "pluginId", "key");

-- AddForeignKey
ALTER TABLE "WorkspaceLicense" ADD CONSTRAINT "WorkspaceLicense_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginSetting" ADD CONSTRAINT "PluginSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migraciones propias de los plugins: cada plugin trabaja en su esquema plugin_<id> (fuera de Prisma)
-- y el núcleo registra acá lo aplicado.
CREATE SCHEMA IF NOT EXISTS "plugins";
CREATE TABLE IF NOT EXISTS "plugins"."migrations" (
    "pluginId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_migrations_pkey" PRIMARY KEY ("pluginId", "name")
);
