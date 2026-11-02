-- CreateTable
CREATE TABLE "SafetyItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "category" TEXT,
    "hasSizes" BOOLEAN NOT NULL DEFAULT false,
    "lifeMonths" INTEGER,
    "positionIds" TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "deliveredById" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "signature" BYTEA NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "SafetyDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyDeliveryLine" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "size" TEXT,
    "replaceOn" DATE,

    CONSTRAINT "SafetyDeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SafetyItem_workspaceId_nameKey_key" ON "SafetyItem"("workspaceId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyItem_id_workspaceId_key" ON "SafetyItem"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "SafetyDelivery_workspaceId_membershipId_deliveredAt_idx" ON "SafetyDelivery"("workspaceId", "membershipId", "deliveredAt");

-- CreateIndex
CREATE INDEX "SafetyDelivery_workspaceId_deliveredAt_idx" ON "SafetyDelivery"("workspaceId", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyDelivery_id_workspaceId_key" ON "SafetyDelivery"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "SafetyDeliveryLine_workspaceId_deliveryId_idx" ON "SafetyDeliveryLine"("workspaceId", "deliveryId");

-- CreateIndex
CREATE INDEX "SafetyDeliveryLine_workspaceId_itemId_idx" ON "SafetyDeliveryLine"("workspaceId", "itemId");

-- AddForeignKey
ALTER TABLE "SafetyItem" ADD CONSTRAINT "SafetyItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDelivery" ADD CONSTRAINT "SafetyDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDeliveryLine" ADD CONSTRAINT "SafetyDeliveryLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDeliveryLine" ADD CONSTRAINT "SafetyDeliveryLine_deliveryId_workspaceId_fkey" FOREIGN KEY ("deliveryId", "workspaceId") REFERENCES "SafetyDelivery"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDeliveryLine" ADD CONSTRAINT "SafetyDeliveryLine_itemId_workspaceId_fkey" FOREIGN KEY ("itemId", "workspaceId") REFERENCES "SafetyItem"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;
