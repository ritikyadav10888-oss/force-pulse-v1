import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MeResponse } from '@force-pulse/shared';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
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
    return {
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      roles: user.memberships,
      player: player && { id: player.id, displayName: player.displayName },
    };
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
