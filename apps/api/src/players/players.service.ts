import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ageGroup,
  attributesSchema,
  badgesFor,
  DOCUMENT_CONTENT_TYPES,
  isMinor,
  MAX_UPLOAD_BYTES,
  PHOTO_TYPES,
  rulePackSchema,
  type ContactPerson,
  type DocumentType,
  type DocumentView,
  type MyPlayerProfile,
  type PublicPlayer,
  type UpdatePlayer,
  type UploadTicket,
} from '@force-pulse/shared';
import { Prisma } from '@prisma/client';
import { audit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorage } from '../storage/storage';

const UPLOAD_TTL_SECONDS = 5 * 60;
const PHOTO_URL_TTL_SECONDS = 60 * 60;
const DOCUMENT_URL_TTL_SECONDS = 5 * 60;
const semverKey = (v: string) =>
  v
    .split('.')
    .map((n) => n.padStart(6, '0'))
    .join('.');
const photoPrefix = (playerId: string) => `players/${playerId}/photo/`;
const documentPrefix = (playerId: string) => `players/${playerId}/documents/`;
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

const documentView = (d: {
  id: string;
  type: DocumentType;
  createdAt: Date;
  verifiedAt: Date | null;
}): DocumentView => ({
  id: d.id,
  type: d.type,
  createdAt: d.createdAt.toISOString(),
  verifiedAt: d.verifiedAt?.toISOString() ?? null,
});

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

  private photoUrl(key: string | null) {
    return key ? this.storage.presignDownload(key, PHOTO_URL_TTL_SECONDS) : Promise.resolve(null);
  }

  async myProfile(userId: string): Promise<MyPlayerProfile | null> {
    const p = await this.prisma.player.findUnique({
      where: { userId },
      include: {
        sportProfiles: { include: { sport: { select: { code: true, name: true } } } },
        documents: { orderBy: { createdAt: 'asc' } },
      },
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
      photoUrl: await this.photoUrl(p.photoKey),
      bio: p.bio,
      socialLinks: (p.socialLinksJson as string[] | null) ?? [],
      sportProfiles: p.sportProfiles.map((sp) => ({
        sport: sp.sport,
        rulePackVersion: sp.rulePackVersion,
        attributes: sp.attributesJson as Record<string, unknown>,
        status: sp.status,
      })),
      // The player sees what they uploaded, not the file: ID files are for organizers only.
      documents: p.documents.map(documentView),
    };
  }

  async update(userId: string, playerId: string, body: UpdatePlayer) {
    const player = await this.ownPlayer(userId, playerId);
    const { emergencyContact, guardian, dob, socialLinks, ...rest } = body;
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
        socialLinksJson: socialLinks,
        guardianJson: guardian === null ? Prisma.JsonNull : guardian,
      },
    });
  }

  // ---- uploads (photo, ID documents) -------------------------------------------------------

  private async ticket(prefix: string, contentType: string): Promise<UploadTicket> {
    const key = `${prefix}${randomUUID()}.${EXT[contentType]}`;
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

  /** After the browser PUTs a file: check it is this player's upload, of an allowed type and size. */
  private async verifyUpload(key: string, prefix: string, types: readonly string[], what: string) {
    if (!key.startsWith(prefix) || key.includes('..')) {
      throw new BadRequestException('Not an upload for this player');
    }
    const obj = await this.storage.stat(key);
    if (!obj) throw new BadRequestException('Upload not found; try again');
    if (obj.size > MAX_UPLOAD_BYTES || !types.includes(obj.contentType)) {
      await this.storage.delete(key);
      const allowed = types.map((t) => EXT[t]!.toUpperCase()).join(', ');
      throw new BadRequestException(`${what} must be ${allowed} under 5 MB`);
    }
  }

  async photoUploadTicket(userId: string, playerId: string, contentType: string) {
    await this.ownPlayer(userId, playerId);
    return this.ticket(photoPrefix(playerId), contentType);
  }

  async confirmPhoto(userId: string, playerId: string, key: string) {
    const player = await this.ownPlayer(userId, playerId);
    await this.verifyUpload(key, photoPrefix(playerId), PHOTO_TYPES, 'Photo');
    await this.prisma.player.update({ where: { id: playerId }, data: { photoKey: key } });
    if (player.photoKey && player.photoKey !== key) await this.storage.delete(player.photoKey);
    return { photoUrl: await this.photoUrl(key) };
  }

  async documentUploadTicket(userId: string, playerId: string, contentType: string) {
    await this.ownPlayer(userId, playerId);
    return this.ticket(documentPrefix(playerId), contentType);
  }

  /** One document per type: a new upload replaces the old file and clears its verification. */
  async confirmDocument(userId: string, playerId: string, type: DocumentType, key: string) {
    await this.ownPlayer(userId, playerId);
    await this.verifyUpload(key, documentPrefix(playerId), DOCUMENT_CONTENT_TYPES, 'ID document');
    const old = await this.prisma.playerDocument.findFirst({ where: { playerId, type } });
    const doc = await this.prisma.$transaction(async (tx) => {
      if (old) await tx.playerDocument.delete({ where: { id: old.id } });
      return tx.playerDocument.create({ data: { playerId, type, fileKey: key } });
    });
    if (old) await this.storage.delete(old.fileKey);
    return documentView(doc);
  }

  async removeDocument(userId: string, playerId: string, documentId: string) {
    await this.ownPlayer(userId, playerId);
    const doc = await this.prisma.playerDocument.findFirst({ where: { id: documentId, playerId } });
    if (!doc) throw new NotFoundException();
    await this.prisma.playerDocument.delete({ where: { id: doc.id } });
    await this.storage.delete(doc.fileKey);
  }

  // ---- organizer view, public page -------------------------------------------------------

  /**
   * Full profile incl. contact, medical, guardian and ID files, for organizers (owner or
   * co-organizer) of a tournament the player registered for. ID links last 5 minutes and every
   * view of an ID document is audit-logged.
   */
  async privateProfile(callerId: string, playerId: string) {
    const p = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { documents: true, user: { select: { email: true } } },
    });
    if (!p || p.deletedAt) throw new NotFoundException();
    const organizes = await this.prisma.membership.findFirst({
      where: {
        userId: callerId,
        role: { in: ['owner', 'co_organizer'] },
        tournament: { registrations: { some: { playerId } } },
      },
      select: { id: true },
    });
    if (!organizes) {
      throw new ForbiddenException('Only organizers of a tournament this player entered');
    }

    const documents = await Promise.all(
      p.documents.map(async (d) => ({
        ...documentView(d),
        url: await this.storage.presignDownload(d.fileKey, DOCUMENT_URL_TTL_SECONDS),
      })),
    );
    if (p.documents.length) {
      await this.prisma.auditLog.createMany({
        data: p.documents.map((d) => ({
          actorId: callerId,
          action: 'document.viewed',
          entity: 'PlayerDocument',
          entityId: d.id,
        })),
      });
    }
    return {
      id: p.id,
      displayName: p.displayName,
      email: p.user.email,
      dob: p.dob?.toISOString().slice(0, 10) ?? null,
      gender: p.gender,
      city: p.city,
      state: p.state,
      phone: p.phone,
      emergencyContact: p.emergencyContactJson as ContactPerson | null,
      medicalNotes: p.medicalNotes,
      guardian: p.guardianJson as ContactPerson | null,
      photoUrl: await this.photoUrl(p.photoKey),
      documents,
    };
  }

  /** Public fields only: no DOB (age group instead), contact, medical or documents. */
  async publicProfile(playerId: string): Promise<PublicPlayer> {
    const p = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { sportProfiles: { include: { sport: { select: { code: true, name: true } } } } },
    });
    if (!p || p.deletedAt) throw new NotFoundException();
    const packs = p.sportProfiles.length
      ? await this.prisma.rulePack.findMany({
          where: {
            OR: p.sportProfiles.map((sp) => ({ sportId: sp.sportId, version: sp.rulePackVersion })),
          },
          select: { sportId: true, version: true, contentJson: true },
        })
      : [];
    return {
      id: p.id,
      displayName: p.displayName,
      photoUrl: await this.photoUrl(p.photoKey),
      city: p.city,
      state: p.state,
      ageGroup: ageGroup(p.dob),
      bio: p.bio,
      socialLinks: (p.socialLinksJson as string[] | null) ?? [],
      sports: p.sportProfiles.map((sp) => {
        const pack = packs.find(
          (r) => r.sportId === sp.sportId && r.version === sp.rulePackVersion,
        );
        return {
          code: sp.sport.code,
          name: sp.sport.name,
          badges: pack
            ? badgesFor(
                rulePackSchema.parse(pack.contentJson),
                sp.attributesJson as Record<string, unknown>,
              )
            : [],
        };
      }),
    };
  }

  // ---- sport profiles --------------------------------------------------------------------

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
    const exists = await this.prisma.playerSportProfile.findUnique({
      where: { playerId_sportId: { playerId, sportId } },
    });
    if (exists)
      throw new ConflictException('You already have a profile for this sport; edit it instead');
    const data = this.validate(pack, attributes);
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
