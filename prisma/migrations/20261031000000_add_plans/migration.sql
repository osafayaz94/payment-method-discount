-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "Settings" ADD COLUMN "planCheckedAt" DATETIME;

-- CreateTable
CREATE TABLE "Usage" (
    "shop" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("shop", "month")
);
