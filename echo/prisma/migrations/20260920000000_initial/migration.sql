CREATE TABLE "Record" (
  "pk" TEXT NOT NULL,
  "sk" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "data" TEXT NOT NULL,
  PRIMARY KEY ("pk", "sk")
);
CREATE INDEX "Record_organizationId_sk_idx" ON "Record"("organizationId", "sk");
