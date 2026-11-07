-- CreateEnum
CREATE TYPE "SpaceArea" AS ENUM ('WIKI', 'DOCUMENTS', 'PREVENTION', 'QUALITY');

-- CreateEnum
CREATE TYPE "HomeArea" AS ENUM ('HOME', 'DOCUMENTS', 'WIKI', 'PREVENTION', 'QUALITY', 'ADMIN');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "homeArea" "HomeArea";

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "homeArea" "HomeArea";

-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "area" "SpaceArea" NOT NULL DEFAULT 'WIKI';

-- Data: the Prevention module's space (settings.safety.spaceId of its company) goes to its area.
UPDATE "Space" AS s
SET "area" = 'PREVENTION'
FROM "Workspace" AS w
WHERE s."workspaceId" = w."id"
  AND s."id" = w."settings" -> 'safety' ->> 'spaceId';
