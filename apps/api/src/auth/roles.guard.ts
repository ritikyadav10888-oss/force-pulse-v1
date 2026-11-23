import {
  applyDecorators,
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import type { Role } from '@force-pulse/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.guard';

/** Where the guarded route's tournament id comes from. */
type TournamentFrom = 'tournament' | 'registration';
interface RoleRule {
  roles: Role[];
  from: TournamentFrom;
}
const ROLE_RULE = 'roleRule';
const isUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Requires one of `roles` in the tournament the route acts on (`:id` is a tournament or a
 * registration id). super_admin passes everywhere. Wrong role → 403.
 */
export const TournamentRoles = (roles: Role[], from: TournamentFrom = 'tournament') =>
  applyDecorators(
    SetMetadata(ROLE_RULE, { roles, from } satisfies RoleRule),
    UseGuards(TournamentRolesGuard),
    ApiForbiddenResponse({
      description: `Requires role: ${roles.join(' or ')} in this tournament`,
    }),
  );

@Injectable()
export class TournamentRolesGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const rule = this.reflector.get<RoleRule>(ROLE_RULE, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    const id = req.params.id as string;
    // Guards run before pipes, so validate here; a malformed id would otherwise crash the query.
    if (!isUUID(id)) throw new BadRequestException('Invalid id');

    let tournamentId: string | undefined = id;
    if (rule.from === 'registration') {
      const reg = await this.prisma.registration.findUnique({
        where: { id },
        select: { tournamentId: true },
      });
      tournamentId = reg?.tournamentId;
    }
    if (!tournamentId) throw new NotFoundException();

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: req.user.id,
        OR: [
          { tournamentId: null, role: 'super_admin' },
          { tournamentId, role: { in: rule.roles } },
        ],
      },
    });
    if (!membership) throw new ForbiddenException('You do not have access to this tournament');
    return true;
  }
}
