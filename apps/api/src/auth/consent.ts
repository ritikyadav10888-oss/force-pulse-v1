import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { POLICY_VERSION, type ConsentScope } from '@force-pulse/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { isPublic, type AuthUser } from './auth.guard';

const SKIP_CONSENT = 'skipConsent';
/** Routes a signed-in user needs before consenting (reading /me, giving consent). */
export const SkipConsent = () => SetMetadata(SKIP_CONSENT, true);

export async function consentedScopes(prisma: PrismaService, userId: string) {
  const rows = await prisma.consent.findMany({
    where: { userId, policyVersion: POLICY_VERSION },
    select: { scope: true },
  });
  return [...new Set(rows.map((r) => r.scope as ConsentScope))];
}

/** Global guard after AuthGuard: no data_use consent under the current policy → 403 consent_required. */
@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (
      isPublic(this.reflector, ctx) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_CONSENT, targets)
    ) {
      return true;
    }
    const { user } = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    const found = await this.prisma.consent.findFirst({
      where: { userId: user.id, policyVersion: POLICY_VERSION, scope: 'data_use' },
      select: { id: true },
    });
    if (!found) {
      throw new ForbiddenException({
        code: 'consent_required',
        message: 'Please accept the privacy policy first',
      });
    }
    return true;
  }
}
