-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "code" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPrefs" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Task_orgId_code_key" ON "Task"("orgId", "code");

