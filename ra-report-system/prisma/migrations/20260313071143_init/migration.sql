-- CreateEnum
CREATE TYPE "Campus" AS ENUM ('College Ave', 'Busch', 'Cook/Douglass', 'Livingston');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('RA', 'ARLC', 'RLC');

-- CreateEnum
CREATE TYPE "ReportNature" AS ENUM ('Title IX', 'Mental Health Concern', 'Policy Violation', 'Roommate Conflict', 'General Residence Life Concern', 'Facilities Issues');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('DRUG_CANNABIS', 'ALCOHOL_UNDERAGE', 'FIRE_SAFETY_HOTPLATE', 'FIRE_SAFETY_CANDLE', 'FIRE_SAFETY_LITHIUM', 'NOISE', 'GUEST_OVERSTAY', 'GUEST_PROPPED', 'PROHIBITED_ITEM', 'VANDALISM', 'SMOKING', 'DISRUPTION', 'WEAPONS');

-- CreateEnum
CREATE TYPE "MentalHealthSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRISIS');

-- CreateEnum
CREATE TYPE "StudentRole" AS ENUM ('ACCUSED', 'VICTIM', 'WITNESS', 'STUDENT_OF_CONCERN', 'INVOLVED_PARTY', 'FACILITIES_CONCERN', 'NO_STUDENT_INVOLVED');

-- CreateEnum
CREATE TYPE "RoleInReport" AS ENUM ('RA', 'ARLC', 'RLC');

-- CreateTable
CREATE TABLE "buildings" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "campus" "Campus" NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" SERIAL NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT,
    "role" "StaffRole" NOT NULL,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "report_id" TEXT NOT NULL,
    "building_id" INTEGER NOT NULL,
    "specific_location" TEXT NOT NULL,
    "nature" "ReportNature" NOT NULL,
    "policy_type" "PolicyType",
    "severity_level" "MentalHealthSeverity",
    "concern_type" TEXT,
    "issue_type" TEXT,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "submitted_by_id" INTEGER NOT NULL,
    "rupd_called" BOOLEAN NOT NULL DEFAULT false,
    "cad_number" TEXT,
    "ems_present" BOOLEAN NOT NULL DEFAULT false,
    "transported" BOOLEAN NOT NULL DEFAULT false,
    "emergency_single" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_staff" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "staff_id" INTEGER NOT NULL,
    "role_in_report" "RoleInReport" NOT NULL,

    CONSTRAINT "report_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "ruid" TEXT,
    "dob" DATE,
    "phone" TEXT,
    "email" TEXT,
    "hall" TEXT,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_students" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "role" "StudentRole" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "report_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "event_time" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "actor" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buildings_name_key" ON "buildings"("name");

-- CreateIndex
CREATE UNIQUE INDEX "staff_username_key" ON "staff"("username");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "reports_report_id_key" ON "reports"("report_id");

-- CreateIndex
CREATE INDEX "reports_building_id_idx" ON "reports"("building_id");

-- CreateIndex
CREATE INDEX "reports_nature_idx" ON "reports"("nature");

-- CreateIndex
CREATE INDEX "reports_date_idx" ON "reports"("date");

-- CreateIndex
CREATE INDEX "reports_rupd_called_idx" ON "reports"("rupd_called");

-- CreateIndex
CREATE UNIQUE INDEX "report_staff_report_id_staff_id_key" ON "report_staff"("report_id", "staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_ruid_key" ON "students"("ruid");

-- CreateIndex
CREATE UNIQUE INDEX "report_students_report_id_student_id_key" ON "report_students"("report_id", "student_id");

-- CreateIndex
CREATE INDEX "timeline_events_report_id_idx" ON "timeline_events"("report_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_staff" ADD CONSTRAINT "report_staff_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_staff" ADD CONSTRAINT "report_staff_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_students" ADD CONSTRAINT "report_students_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_students" ADD CONSTRAINT "report_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
