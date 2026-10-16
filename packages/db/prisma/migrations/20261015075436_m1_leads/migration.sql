-- DropIndex
DROP INDEX "Lead_customerId_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Lead_customerId_status_idx" ON "Lead"("customerId", "status");

-- Short lead codes for bot commands (SPEC 7: Lead.code). v1 has a single org, so one global sequence
-- keeps codes unique per org without a lock. The seed advances it past demo data.
CREATE SEQUENCE IF NOT EXISTS lead_code_seq START WITH 1001;
