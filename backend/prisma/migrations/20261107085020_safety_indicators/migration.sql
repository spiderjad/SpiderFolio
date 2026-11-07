-- AlterTable
ALTER TABLE "SafetyIncident" ADD COLUMN     "lostDays" INTEGER;

-- CreateTable
CREATE TABLE "SafetyMonthStat" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "departmentId" TEXT,
    "hoursWorked" INTEGER NOT NULL,
    "avgHeadcount" DOUBLE PRECISION NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyMonthStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyMonthStat_workspaceId_departmentId_month_idx" ON "SafetyMonthStat"("workspaceId", "departmentId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyMonthStat_workspaceId_month_departmentId_key" ON "SafetyMonthStat"("workspaceId", "month", "departmentId");

-- AddForeignKey
ALTER TABLE "SafetyMonthStat" ADD CONSTRAINT "SafetyMonthStat_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The unique index above lets two whole-company rows (departmentId NULL) for the same month in: this
-- one doesn't (Prisma can't express a partial index).
CREATE UNIQUE INDEX "SafetyMonthStat_company_month_key" ON "SafetyMonthStat"("workspaceId", "month") WHERE "departmentId" IS NULL;

-- Days of leave are a count, never negative.
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_lostDays_check" CHECK ("lostDays" IS NULL OR "lostDays" >= 0);
