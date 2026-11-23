-- Role model v2: creator = owner, co-organizers, super admin as a user flag.

-- 1. Super admin moves from a global membership to a flag on User.
ALTER TABLE "users" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "isSuperAdmin" = true
WHERE "id" IN (SELECT "userId" FROM "memberships" WHERE "role" = 'super_admin');

-- 2. Tournaments created before ownership existed have no owner and cannot satisfy "exactly one
--    owner". Only seeded demo data exists at this point (staging), so remove it; owners now create
--    their own tournaments. Order respects foreign keys.
DELETE FROM "registrations";
DELETE FROM "memberships";
DELETE FROM "tournaments";
DELETE FROM "events";

-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('self_registered', 'added_by_organizer', 'invite_link');

-- CreateEnum
CREATE TYPE "InviteKind" AS ENUM ('co_organizer', 'player');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('owner', 'co_organizer', 'team_owner', 'player');
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
COMMIT;


-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "invitedById" UUID,
ALTER COLUMN "tournamentId" SET NOT NULL;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "createdById" UUID NOT NULL;

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "modulesJson" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "selfApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "RegistrationSource" NOT NULL DEFAULT 'self_registered';

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "kind" "InviteKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invites_tokenHash_key" ON "invites"("tokenHash");

-- CreateIndex
CREATE INDEX "invites_tournamentId_idx" ON "invites"("tournamentId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 3. Exactly one owner per tournament. Partial unique index: Prisma's schema can't express it,
--    so CI's drift check allows this one index (see .github/workflows/ci.yml).
CREATE UNIQUE INDEX "memberships_one_owner_per_tournament" ON "memberships"("tournamentId") WHERE "role" = 'owner';
