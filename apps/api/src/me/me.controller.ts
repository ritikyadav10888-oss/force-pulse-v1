import { Body, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  consentSchema,
  POLICY_VERSION,
  type ConsentScope,
  type MeResponse,
} from '@force-pulse/shared';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { consentedScopes, SkipConsent } from '../auth/consent';
import { apiSchema, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @SkipConsent()
  @ApiOkResponse({ description: 'Current user, roles and core profile (null until created)' })
  async me(@CurrentUser() { id }: AuthUser): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        memberships: { select: { role: true, tournamentId: true } },
        player: { select: { id: true, displayName: true, deletedAt: true } },
      },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    const player = user.player && !user.player.deletedAt ? user.player : null;
    const scopes = await consentedScopes(this.prisma, id);
    return {
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      roles: user.memberships,
      player: player && { id: player.id, displayName: player.displayName },
      consent: { policyVersion: POLICY_VERSION, scopes, required: !scopes.includes('data_use') },
    };
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
