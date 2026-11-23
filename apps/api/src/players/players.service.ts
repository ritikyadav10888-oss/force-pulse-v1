import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  attributesSchema,
  isMinor,
  MAX_UPLOAD_BYTES,
  PHOTO_TYPES,
  rulePackSchema,
  type ContactPerson,
  type MyPlayerProfile,
  type UpdatePlayer,
  type UploadTicket,
} from '@force-pulse/shared';
import { Prisma } from '@prisma/client';
import { audit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorage } from '../storage/storage';

const UPLOAD_TTL_SECONDS = 5 * 60;
const PHOTO_URL_TTL_SECONDS = 60 * 60;
const semverKey = (v: string) =>
  v
    .split('.')
    .map((n) => n.padStart(6, '0'))
    .join('.');
const photoPrefix = (playerId: string) => `players/${playerId}/photo/`;

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
  ) {}

  /** Loads a live player and checks the caller owns it. */
  async ownPlayer(userId: string, playerId: string) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player || player.deletedAt) throw new NotFoundException();
    if (player.userId !== userId) throw new ForbiddenException();
    return player;
  }

  async myProfile(userId: string): Promise<MyPlayerProfile | null> {
    const p = await this.prisma.player.findUnique({
      where: { userId },
      include: { sportProfiles: { include: { sport: { select: { code: true, name: true } } } } },
    });
    if (!p || p.deletedAt) return null;
    return {
      id: p.id,
      displayName: p.displayName,
      dob: p.dob?.toISOString().slice(0, 10) ?? null,
      gender: p.gender,
      city: p.city,
      state: p.state,
      phone: p.phone,
      emergencyContact: p.emergencyContactJson as ContactPerson | null,
      medicalNotes: p.medicalNotes,
      guardian: p.guardianJson as ContactPerson | null,
      photoUrl: p.photoKey
        ? await this.storage.presignDownload(p.photoKey, PHOTO_URL_TTL_SECONDS)
        : null,
      sportProfiles: p.sportProfiles.map((sp) => ({
        sport: sp.sport,
        rulePackVersion: sp.rulePackVersion,
        attributes: sp.attributesJson as Record<string, unknown>,
        status: sp.status,
      })),
    };
  }

  async update(userId: string, playerId: string, body: UpdatePlayer) {
    const player = await this.ownPlayer(userId, playerId);
    const { emergencyContact, guardian, dob, ...rest } = body;
    const touchesSafety =
      body.phone !== undefined ||
      emergencyContact !== undefined ||
      body.medicalNotes !== undefined ||
      guardian !== undefined;
    const nextDob = dob ?? player.dob;
    const nextGuardian = guardian === undefined ? player.guardianJson : guardian;
    // Checked when saving the contact & safety step, so step 1 can save a minor's DOB first.
    if (touchesSafety && isMinor(nextDob) && !nextGuardian) {
      throw new BadRequestException('Players under 18 need a parent or guardian contact');
    }
    return this.prisma.player.update({
      where: { id: playerId },
      data: {
        ...rest,
        dob: dob ? new Date(dob) : undefined,
        emergencyContactJson: emergencyContact,
        guardianJson: guardian === null ? Prisma.JsonNull : guardian,
      },
    });
  }

  // ---- photo -------------------------------------------------------------------------------

  async photoUploadTicket(
    userId: string,
    playerId: string,
    contentType: (typeof PHOTO_TYPES)[number],
  ): Promise<UploadTicket> {
    await this.ownPlayer(userId, playerId);
    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const key = `${photoPrefix(playerId)}${randomUUID()}.${ext}`;
    const { url, headers } = await this.storage.presignUpload(
      key,
      contentType,
      MAX_UPLOAD_BYTES,
      UPLOAD_TTL_SECONDS,
    );
    return {
      key,
      uploadUrl: url,
      headers,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** After the browser PUTs the file: verify it really is our object, then make it the photo. */
  async confirmPhoto(userId: string, playerId: string, key: string) {
    const player = await this.ownPlayer(userId, playerId);
    if (!key.startsWith(photoPrefix(playerId)) || key.includes('..')) {
      throw new BadRequestException('Not an upload for this player');
    }
    const obj = await this.storage.stat(key);
    if (!obj) throw new BadRequestException('Upload not found; try again');
    if (
      obj.size > MAX_UPLOAD_BYTES ||
      !(PHOTO_TYPES as readonly string[]).includes(obj.contentType)
    ) {
      await this.storage.delete(key);
      throw new BadRequestException('Photo must be a JPEG or PNG under 5 MB');
    }
    await this.prisma.player.update({ where: { id: playerId }, data: { photoKey: key } });
    if (player.photoKey && player.photoKey !== key) await this.storage.delete(player.photoKey);
    return { photoUrl: await this.storage.presignDownload(key, PHOTO_URL_TTL_SECONDS) };
  }

  // ---- sport profiles ------------------------------------------------------------------------

  /** The sport's latest published pack, parsed. Profiles are always validated against it. */
  private async currentPack(sportCode: string) {
    const rows = await this.prisma.rulePack.findMany({
      where: { sport: { code: sportCode } },
      select: { version: true, contentJson: true, sportId: true },
    });
    const latest = rows.sort((a, b) => semverKey(b.version).localeCompare(semverKey(a.version)))[0];
    if (!latest) throw new NotFoundException(`Unknown sport "${sportCode}"`);
    return {
      sportId: latest.sportId,
      version: latest.version,
      pack: rulePackSchema.parse(latest.contentJson),
    };
  }

  private validate(pack: Parameters<typeof attributesSchema>[0], attributes: unknown) {
    const result = attributesSchema(pack).safeParse(attributes);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data as Prisma.InputJsonValue;
  }

  async addSportProfile(userId: string, playerId: string, sportCode: string, attributes: unknown) {
    await this.ownPlayer(userId, playerId);
    const { sportId, version, pack } = await this.currentPack(sportCode);
    const data = this.validate(pack, attributes);
    const exists = await this.prisma.playerSportProfile.findUnique({
      where: { playerId_sportId: { playerId, sportId } },
    });
    if (exists)
      throw new ConflictException('You already have a profile for this sport; edit it instead');
    return this.prisma.playerSportProfile.create({
      data: { playerId, sportId, rulePackVersion: version, attributesJson: data },
    });
  }

  /**
   * Edit re-validates against the current pack (moving the profile to that version). If an organizer
   * already approved the player in this sport, the edit sends those registrations back for review.
   */
  async editSportProfile(userId: string, playerId: string, sportCode: string, attributes: unknown) {
    await this.ownPlayer(userId, playerId);
    const { sportId, version, pack } = await this.currentPack(sportCode);
    const data = this.validate(pack, attributes);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.playerSportProfile.findUnique({
        where: { playerId_sportId: { playerId, sportId } },
      });
      if (!before) throw new NotFoundException('No profile for this sport yet');
      const approved = await tx.registration.findMany({
        where: { playerId, status: 'approved', tournament: { sportId } },
        select: { id: true, tournamentId: true },
      });
      const needsReview = approved.length > 0;
      const after = await tx.playerSportProfile.update({
        where: { id: before.id },
        data: {
          attributesJson: data,
          rulePackVersion: version,
          ...(needsReview ? { status: 'pending_review' as const } : {}),
        },
      });
      if (needsReview) {
        await tx.registration.updateMany({
          where: { id: { in: approved.map((r) => r.id) } },
          data: {
            status: 'pending',
            reason: 'Sport profile edited after approval',
            selfApproved: false,
          },
        });
        await tx.membership.deleteMany({
          where: {
            userId,
            tournamentId: { in: approved.map((r) => r.tournamentId) },
            role: 'player',
          },
        });
        await audit(tx, {
          actorId: userId,
          action: 'sport_profile.edited_after_approval',
          entity: 'PlayerSportProfile',
          entityId: before.id,
          before: before.attributesJson,
          after: data,
        });
      }
      return after;
    });
  }

  async removeSportProfile(userId: string, playerId: string, sportCode: string) {
    await this.ownPlayer(userId, playerId);
    const { count } = await this.prisma.playerSportProfile.deleteMany({
      where: { playerId, sport: { code: sportCode } },
    });
    if (count === 0) throw new NotFoundException();
  }
}
