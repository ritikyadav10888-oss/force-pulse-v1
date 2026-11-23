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
import { PERMISSIONS, type Permission, type Role } from '@force-pulse/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.guard';

/** Where the guarded route's tournament id comes from: `:id` is a tournament or a registration. */
type TournamentFrom = 'tournament' | 'registration';
interface Rule {
  permission: Permission;
  from: TournamentFrom;
}
const RULE = 'tournamentPermission';
const isUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** The caller's roles in the tournament the route acts on, for handlers that need them. */
export type TournamentRequest = Request & {
  user: AuthUser;
  tournament: { id: string; roles: Role[] };
};

/**
 * Requires `permission` (see PERMISSIONS in shared) in the tournament behind `:id`.
 * Wrong role → 403. Super admins get no bypass: they run the platform, not tournaments.
 */
export const TournamentPermission = (permission: Permission, from: TournamentFrom = 'tournament') =>
  applyDecorators(
    SetMetadata(RULE, { permission, from } satisfies Rule),
    UseGuards(TournamentPermissionGuard),
    ApiForbiddenResponse({
      description: `Requires one of: ${PERMISSIONS[permission].join(', ')} in this tournament`,
    }),
  );

@Injectable()
export class TournamentPermissionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const rule = this.reflector.get<Rule>(RULE, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<TournamentRequest>();
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
    } else if (!(await this.prisma.tournament.count({ where: { id } }))) {
      tournamentId = undefined;
    }
    if (!tournamentId) throw new NotFoundException();

    const roles = (
      await this.prisma.membership.findMany({
        where: { userId: req.user.id, tournamentId },
        select: { role: true },
      })
    ).map((m) => m.role);
    if (!roles.some((r) => (PERMISSIONS[rule.permission] as readonly Role[]).includes(r))) {
      throw new ForbiddenException('You do not have permission for this in this tournament');
    }
    req.tournament = { id: tournamentId, roles };
    return true;
  }
}
