import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { audit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorage } from '../storage/storage';

/** "Download my data" and "Delete my account". */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
  ) {}

  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        createdAt: true,
        consents: { select: { policyVersion: true, scope: true, consentedAt: true } },
        memberships: {
          select: { role: true, createdAt: true, tournament: { select: { name: true } } },
        },
        player: {
          include: {
            sportProfiles: { include: { sport: { select: { code: true } } } },
            documents: { select: { type: true, createdAt: true, verifiedAt: true } },
            registrations: {
              select: {
                status: true,
                reason: true,
                source: true,
                createdAt: true,
                reviewedAt: true,
                tournament: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException();
    // Internal ids and storage keys are left out; document files themselves are only listed.
    const { player, ...account } = user;
    return {
      exportedAt: new Date().toISOString(),
      account,
      player: player && {
        displayName: player.displayName,
        dob: player.dob,
        gender: player.gender,
        phone: player.phone,
        city: player.city,
        state: player.state,
        organization: player.organization,
        bio: player.bio,
        socialLinks: player.socialLinksJson,
        emergencyContact: player.emergencyContactJson,
        medicalNotes: player.medicalNotes,
        guardian: player.guardianJson,
        jerseySize: player.jerseySize,
        jerseyNumber: player.jerseyNumber,
        hasPhoto: !!player.photoKey,
        sportProfiles: player.sportProfiles.map((sp) => ({
          sport: sp.sport.code,
          rulePackVersion: sp.rulePackVersion,
          attributes: sp.attributesJson,
          status: sp.status,
        })),
        documents: player.documents,
        registrations: player.registrations,
      },
    };
  }

  /**
   * Soft delete, then purge personal fields at once. Registrations stay (tournament history) but
   * point at an anonymous "Deleted player". Owners must hand over their tournaments first.
   */
  async delete(userId: string) {
    const owns = await this.prisma.membership.count({ where: { userId, role: 'owner' } });
    if (owns) {
      throw new ConflictException(
        'You own a tournament. Transfer ownership to a co-organizer before deleting your account.',
      );
    }
    const player = await this.prisma.player.findUnique({
      where: { userId },
      include: { documents: { select: { fileKey: true } } },
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: now,
          // Frees the Google account: signing in again later starts a fresh account.
          googleSub: `deleted:${userId}`,
          email: `deleted+${userId}@deleted.invalid`,
          name: 'Deleted user',
          avatarUrl: null,
          isSuperAdmin: false,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.consent.deleteMany({ where: { userId } });
      await tx.membership.deleteMany({ where: { userId } });
      if (player) {
        await tx.playerSportProfile.deleteMany({ where: { playerId: player.id } });
        await tx.playerDocument.deleteMany({ where: { playerId: player.id } });
        await tx.player.update({
          where: { id: player.id },
          data: {
            deletedAt: now,
            displayName: 'Deleted player',
            dob: null,
            gender: null,
            phone: null,
            city: null,
            state: null,
            organization: null,
            bio: null,
            socialLinksJson: Prisma.DbNull,
            emergencyContactJson: Prisma.DbNull,
            medicalNotes: null,
            guardianJson: Prisma.DbNull,
            jerseySize: null,
            jerseyNumber: null,
            photoKey: null,
          },
        });
      }
      await audit(tx, {
        actorId: userId,
        action: 'account.deleted',
        entity: 'User',
        entityId: userId,
      });
    });
    // Files go after the database commit; a failure here leaves orphans, never a half-deleted account.
    const keys = [player?.photoKey, ...(player?.documents.map((d) => d.fileKey) ?? [])];
    await Promise.all(keys.filter((k): k is string => !!k).map((k) => this.storage.delete(k)));
  }
}
