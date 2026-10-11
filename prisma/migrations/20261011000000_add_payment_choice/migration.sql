-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "cardDiscount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "cardLabel" TEXT NOT NULL DEFAULT 'Card payment discount';
ALTER TABLE "Settings" ADD COLUMN "codGateways" TEXT NOT NULL DEFAULT 'Cash on Delivery (COD)';
ALTER TABLE "Settings" ADD COLUMN "discountId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "paymentCustomizationId" TEXT;
