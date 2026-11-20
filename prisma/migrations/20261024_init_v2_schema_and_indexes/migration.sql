-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PAUSED', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "Specialization" AS ENUM ('BACKEND', 'FRONTEND', 'FULLSTACK', 'MOBILE', 'DEVOPS', 'UIUX', 'DATA', 'QA', 'SECURITY', 'AI_ENGINEER');

-- CreateEnum
CREATE TYPE "RegionPreference" AS ENUM ('ARAB', 'INTERNATIONAL', 'BOTH');

-- CreateEnum
CREATE TYPE "RemoteScope" AS ENUM ('WORLDWIDE', 'REGION', 'COUNTRY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('LIKE', 'DISLIKE', 'NONE');

-- CreateEnum
CREATE TYPE "ExperienceLevel" AS ENUM ('JUNIOR', 'MID', 'SENIOR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WorkType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "firstName" TEXT,
    "username" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pausedUntil" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specializations" "Specialization"[],
    "regionPreference" "RegionPreference" NOT NULL DEFAULT 'BOTH',
    "experienceLevel" TEXT,
    "workType" TEXT,
    "preferenceHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "applicationUrl" TEXT,
    "location" TEXT,
    "country" TEXT,
    "remoteScope" "RemoteScope" NOT NULL DEFAULT 'UNKNOWN',
    "primarySpecialization" "Specialization" NOT NULL,
    "secondarySpecialization" "Specialization",
    "experienceLevel" "ExperienceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "workType" "WorkType" NOT NULL DEFAULT 'UNKNOWN',
    "description" TEXT NOT NULL,
    "skills" TEXT[],
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "currency" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedback" "FeedbackType" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "SentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySlot" (
    "id" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "scheduledTime" TIMESTAMP(3) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeliverySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestDelivery" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "DigestDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "UserPreference_preferenceHash_idx" ON "UserPreference"("preferenceHash");

-- CreateIndex
CREATE UNIQUE INDEX "Job_deduplicationKey_key" ON "Job"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Job_semanticKey_idx" ON "Job"("semanticKey");

-- CreateIndex
CREATE INDEX "Job_status_publishedAt_idx" ON "Job"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Job_primarySpecialization_remoteScope_status_idx" ON "Job"("primarySpecialization", "remoteScope", "status");

-- CreateIndex
CREATE INDEX "SentJob_userId_sentAt_idx" ON "SentJob"("userId", "sentAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SentJob_userId_jobId_key" ON "SentJob"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySlot_slotKey_key" ON "DeliverySlot"("slotKey");

-- CreateIndex
CREATE INDEX "DeliverySlot_scheduledTime_idx" ON "DeliverySlot"("scheduledTime");

-- CreateIndex
CREATE INDEX "DeliverySlot_status_idx" ON "DeliverySlot"("status");

-- CreateIndex
CREATE INDEX "DigestDelivery_slotId_status_idx" ON "DigestDelivery"("slotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DigestDelivery_slotId_userId_key" ON "DigestDelivery"("slotId", "userId");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentJob" ADD CONSTRAINT "SentJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentJob" ADD CONSTRAINT "SentJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestDelivery" ADD CONSTRAINT "DigestDelivery_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "DeliverySlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestDelivery" ADD CONSTRAINT "DigestDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
