import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  completeness,
  consentSchema,
  POLICY_VERSION,
  type ConsentScope,
  type MeResponse,
  type MyPlayerProfile,
  type Modules,
  type MyTournament,
  type Role,
} from '@force-pulse/shared';
import type { Response } from 'express';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { clearAuthCookies } from '../auth/cookies';
import { consentedScopes, SkipConsent } from '../auth/consent';
import { apiSchema, ZodPipe } from '../common/zod';
import { PlayersService } from '../players/players.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly players: PlayersService,
    private readonly account: AccountService,
  ) {}

  @Get()
  @SkipConsent()
  @ApiOkResponse({ description: 'Current user, roles and core profile (null until created)' })
  async me(@CurrentUser() { id }: AuthUser): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        memberships: { select: { role: true, tournamentId: true } },
        player: {
          select: {
            id: true,
            displayName: true,
            deletedAt: true,
            dob: true,
            gender: true,
            city: true,
            photoKey: true,
            emergencyContactJson: true,
            guardianJson: true,
            _count: { select: { sportProfiles: true, documents: true } },
          },
        },
      },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    const player = user.player && !user.player.deletedAt ? user.player : null;
    const scopes = await consentedScopes(this.prisma, id);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isSuperAdmin: user.isSuperAdmin,
      },
      roles: user.memberships,
      player: player && { id: player.id, displayName: player.displayName },
      consent: { policyVersion: POLICY_VERSION, scopes, required: !scopes.includes('data_use') },
      completeness:
        player &&
        completeness({
          dob: player.dob,
          gender: player.gender,
          city: player.city,
          hasPhoto: !!player.photoKey,
          emergencyContact: player.emergencyContactJson,
          guardian: player.guardianJson,
          sportCount: player._count.sportProfiles,
          documentCount: player._count.documents,
        }),
    };
  }

  @Get('data')
  @Header('Content-Disposition', 'attachment; filename="force-pulse-my-data.json"')
  @ApiOkResponse({ description: 'Everything we store about you, as a JSON download' })
  exportData(@CurrentUser() { id }: AuthUser) {
    return this.account.export(id);
  }

  @Delete('data')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Account deleted: personal data purged, sessions ended' })
  @ApiConflictResponse({ description: 'You still own a tournament; transfer it first' })
  async deleteAccount(@CurrentUser() { id }: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.account.delete(id);
    clearAuthCookies(res);
  }

  @Post('consent')
  @SkipConsent()
  @HttpCode(200)
  @ApiBody({ schema: apiSchema(consentSchema) })
  @ApiOkResponse({
    description: 'Consent recorded for the current policy version (data_use required)',
  })
  async consent(
    @CurrentUser() { id }: AuthUser,
    @Body(new ZodPipe(consentSchema)) body: { scopes: ConsentScope[] },
  ) {
    const have = await consentedScopes(this.prisma, id);
    const add = [...new Set(body.scopes)].filter((s) => !have.includes(s));
    if (add.length) {
      await this.prisma.consent.createMany({
        data: add.map((scope) => ({ userId: id, policyVersion: POLICY_VERSION, scope })),
      });
    }
    return { policyVersion: POLICY_VERSION, scopes: [...have, ...add] };
  }

  @Get('player')
  @ApiOkResponse({ description: 'Full own profile for the wizard (null until step 1 is saved)' })
  player(@CurrentUser() { id }: AuthUser): Promise<MyPlayerProfile | null> {
    return this.players.myProfile(id);
  }

  @Get('tournaments')
  @ApiOkResponse({ description: 'Every tournament the user is in, with their role(s) in each' })
  async tournaments(@CurrentUser() { id }: AuthUser): Promise<MyTournament[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId: id },
      select: {
        role: true,
        tournament: {
          select: {
            id: true,
            name: true,
            category: true,
            registrationOpen: true,
            modulesJson: true,
            sport: { select: { code: true, name: true } },
            event: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const byId = new Map<string, MyTournament>();
    for (const { role, tournament: t } of rows) {
      const entry = byId.get(t.id) ?? {
        id: t.id,
        name: t.name,
        category: t.category,
        registrationOpen: t.registrationOpen,
        modules: t.modulesJson as Modules,
        sport: t.sport,
        event: t.event,
        roles: [] as Role[],
      };
      entry.roles.push(role);
      byId.set(t.id, entry);
    }
    return [...byId.values()];
  }

  @Get('registrations')
  @ApiOkResponse({ description: "The signed-in player's registrations with status and reason" })
  registrations(@CurrentUser() { id }: AuthUser) {
    return this.prisma.registration.findMany({
      where: { player: { userId: id } },
      select: {
        id: true,
        status: true,
        reason: true,
        createdAt: true,
        reviewedAt: true,
        tournament: {
          select: {
            id: true,
            name: true,
            category: true,
            sport: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
