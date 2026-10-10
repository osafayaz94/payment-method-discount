-- CreateTable
CREATE TABLE "Settings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "percent" REAL NOT NULL DEFAULT 5,
    "gateways" TEXT NOT NULL DEFAULT 'Bank Deposit',
    "label" TEXT NOT NULL DEFAULT 'Bank Deposit discount',
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
