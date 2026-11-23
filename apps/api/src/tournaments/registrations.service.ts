import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Modules, RegistrationStatus } from '@force-pulse/shared';
import { audit } from '../common/audit';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';

const ageOn = (dob: Date, on: Date) => {
  const age = on.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < dob.getUTCMonth() ||
    (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() < dob.getUTCDate());
  return beforeBirthday ? age - 1 : age;
};

@Injectable()
export class RegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, tournamentId: string) {
    const [player, t] = await Promise.all([
      this.prisma.player.findUnique({ where: { userId } }),
      this.prisma.tournament.findUnique({ where: { id: tournamentId }, include: { event: true } }),
    ]);
    if (!t) throw new NotFoundException('Tournament not found');
    if (!player || player.deletedAt)
      throw new BadRequestException('Create your player profile first');
    if (!(t.modulesJson as Modules).registration) {
      throw new BadRequestException('This tournament adds players directly; ask the organizer');
    }
    if (!t.registrationOpen || (t.registrationDeadline && t.registrationDeadline < new Date())) {
      throw new BadRequestException('Registration is closed');
    }
    this.checkEligibility(t, player);

    const existing = await this.prisma.registration.findUnique({
      where: { playerId_tournamentId: { playerId: player.id, tournamentId } },
    });
    // A rejected player can fix their profile and resubmit; anything else is a duplicate.
    if (existing?.status === 'rejected') {
      return this.prisma.registration.update({
        where: { id: existing.id },
        data: { status: 'pending', reason: null, reviewedById: null, reviewedAt: null },
      });
    }
    if (existing) throw new ConflictException('Already registered');
    try {
      return await this.prisma.registration.create({ data: { playerId: player.id, tournamentId } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Already registered');
      throw e;
    }
  }

  private checkEligibility(
    t: {
      genderRule: string;
      ageMin: number | null;
      ageMax: number | null;
      event: { startDate: Date };
    },
    p: { gender: string | null; dob: Date | null },
  ) {
    if (t.genderRule === 'men' && p.gender !== 'male')
      throw new BadRequestException("This is a men's tournament");
    if (t.genderRule === 'women' && p.gender !== 'female') {
      throw new BadRequestException("This is a women's tournament");
    }
    if (t.ageMin !== null || t.ageMax !== null) {
      if (!p.dob) throw new BadRequestException('Add your date of birth first');
      const age = ageOn(p.dob, t.event.startDate);
      if ((t.ageMin !== null && age < t.ageMin) || (t.ageMax !== null && age > t.ageMax)) {
        throw new BadRequestException(
          `Age must be ${t.ageMin ?? 0}–${t.ageMax ?? '∞'} on the event start date`,
        );
      }
    }
  }

  list(tournamentId: string, status?: RegistrationStatus) {
    return this.prisma.registration.findMany({
      where: { tournamentId, status },
      select: {
        id: true,
        status: true,
        reason: true,
        createdAt: true,
        reviewedAt: true,
        source: true,
        selfApproved: true,
        player: { select: { id: true, displayName: true, city: true, gender: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Approve or reject. Approval makes the player a member (role player) of the tournament; a later
   * rejection removes that. Reviewing your own registration (owner who also plays) is allowed but
   * flagged as self-approved and audit-logged.
   */
  review(actorId: string, id: string, input: { status: 'approved' | 'rejected'; reason?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.registration.findUnique({
        where: { id },
        include: { player: { select: { userId: true } } },
      });
      if (!before) throw new NotFoundException();
      const selfApproved = input.status === 'approved' && before.player.userId === actorId;
      const after = await tx.registration.update({
        where: { id },
        data: {
          status: input.status,
          reason: input.status === 'rejected' ? input.reason : (input.reason ?? null),
          reviewedById: actorId,
          reviewedAt: new Date(),
          selfApproved,
        },
      });
      const membership = {
        userId: before.player.userId,
        tournamentId: before.tournamentId,
        role: 'player' as const,
      };
      if (input.status === 'approved') {
        await tx.membership.upsert({
          where: { userId_tournamentId_role: membership },
          create: membership,
          update: {},
        });
      } else {
        await tx.membership.deleteMany({ where: membership });
      }
      await audit(tx, {
        actorId,
        action: selfApproved ? 'registration.self_approved' : `registration.${input.status}`,
        entity: 'Registration',
        entityId: id,
        before: { status: before.status, reason: before.reason },
        after: { status: after.status, reason: after.reason, selfApproved },
      });
      return after;
    });
  }
}
