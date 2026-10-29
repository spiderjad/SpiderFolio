-- AlterTable
ALTER TABLE "AuthToken" ADD COLUMN     "data" JSONB;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "authProvider" TEXT,
ADD COLUMN     "authWorkspaceId" TEXT;

-- CreateTable
CREATE TABLE "PluginSecret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "suspendedByDirectory" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoFlow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "next" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PluginSecret_workspaceId_pluginId_key_key" ON "PluginSecret"("workspaceId", "pluginId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_membershipId_key" ON "ExternalIdentity"("membershipId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_workspaceId_pluginId_id_idx" ON "ExternalIdentity"("workspaceId", "pluginId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_membershipId_workspaceId_key" ON "ExternalIdentity"("membershipId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_workspaceId_pluginId_provider_externalId_key" ON "ExternalIdentity"("workspaceId", "pluginId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoFlow_stateHash_key" ON "SsoFlow"("stateHash");

-- CreateIndex
CREATE INDEX "SsoFlow_expiresAt_idx" ON "SsoFlow"("expiresAt");

-- AddForeignKey
ALTER TABLE "PluginSecret" ADD CONSTRAINT "PluginSecret_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "Membership"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoFlow" ADD CONSTRAINT "SsoFlow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A standard account always has an email; the password is optional now: someone the company's
-- directory signs in has none until they set one with «Forgot password». PIN accounts don't change.
ALTER TABLE "User" DROP CONSTRAINT "User_kind_credentials_check";
ALTER TABLE "User" ADD CONSTRAINT "User_kind_credentials_check" CHECK (
  ("kind" = 'STANDARD' AND "email" IS NOT NULL)
  OR ("kind" = 'PIN' AND "email" IS NULL AND "passwordHash" IS NULL)
);
