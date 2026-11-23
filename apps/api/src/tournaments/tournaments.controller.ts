import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  listRegistrationsQuerySchema,
  modulesSchema,
  REGISTRATION_STATUSES,
  reviewRegistrationSchema,
  toggleRegistrationSchema,
  type Modules,
  type RegistrationStatus,
} from '@force-pulse/shared';
import type { Prisma } from '@prisma/client';
import { type AuthUser, CurrentUser, Public } from '../auth/auth.guard';
import { TournamentPermission } from '../auth/roles.guard';
import { audit } from '../common/audit';
import { apiSchema, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { RegistrationsService } from './registrations.service';

@ApiTags('tournaments')
@Controller()
export class TournamentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrations: RegistrationsService,
  ) {}

  @Public()
  @Get('tournaments')
  @ApiOkResponse({ description: 'All tournaments with event and sport' })
  list() {
    return this.prisma.tournament.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        entryType: true,
        registrationOpen: true,
        registrationDeadline: true,
        genderRule: true,
        ageMin: true,
        ageMax: true,
        modulesJson: true,
        event: { select: { id: true, name: true, orgName: true, startDate: true, endDate: true } },
        sport: { select: { code: true, name: true } },
      },
      orderBy: [{ event: { startDate: 'asc' } }, { name: 'asc' }],
    });
  }

  @Post('tournaments/:id/registrations')
  @ApiCreatedResponse({ description: 'Registered (pending). Resubmits a rejected registration.' })
  register(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.registrations.register(user.id, id);
  }

  @Get('tournaments/:id/registrations')
  @TournamentPermission('registrations.view')
  @ApiQuery({ name: 'status', required: false, enum: REGISTRATION_STATUSES })
  @ApiOkResponse({ description: 'Approval queue' })
  queue(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(listRegistrationsQuerySchema)) q: { status?: RegistrationStatus },
  ) {
    return this.registrations.list(id, q.status);
  }

  @Patch('registrations/:id')
  @TournamentPermission('registrations.review', 'registration')
  @ApiBody({ schema: apiSchema(reviewRegistrationSchema) })
  @ApiOkResponse({ description: 'Approved or rejected (reason required to reject); audit-logged' })
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewRegistrationSchema))
    body: { status: 'approved' | 'rejected'; reason?: string },
  ) {
    return this.registrations.review(user.id, id, body);
  }

  @Patch('tournaments/:id/registration')
  @TournamentPermission('registration.toggle')
  @ApiBody({ schema: apiSchema(toggleRegistrationSchema) })
  @ApiOkResponse({ description: 'Open or close self-registration (organizer)' })
  async toggleRegistration(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(toggleRegistrationSchema)) body: { open: boolean },
  ) {
    const t = await this.prisma.tournament.findUniqueOrThrow({ where: { id } });
    if (body.open && !(t.modulesJson as Modules).registration) {
      throw new BadRequestException('Turn on the registration module first');
    }
    const updated = await this.prisma.tournament.update({
      where: { id },
      data: { registrationOpen: body.open },
      select: { id: true, registrationOpen: true },
    });
    await audit(this.prisma, {
      actorId: user.id,
      action: body.open ? 'registration.opened' : 'registration.closed',
      entity: 'Tournament',
      entityId: id,
    });
    return updated;
  }

  @Patch('tournaments/:id/modules')
  @TournamentPermission('modules.update')
  @ApiBody({ schema: apiSchema(modulesSchema) })
  @ApiOkResponse({ description: 'Change which modules the tournament uses (owner only)' })
  async updateModules(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(modulesSchema)) modules: Modules,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.tournament.findUniqueOrThrow({ where: { id } });
      const updated = await tx.tournament.update({
        where: { id },
        // Turning registration off also closes it.
        data: {
          modulesJson: modules as Prisma.InputJsonValue,
          ...(modules.registration ? {} : { registrationOpen: false }),
        },
        select: { id: true, modulesJson: true, registrationOpen: true },
      });
      await audit(tx, {
        actorId: user.id,
        action: 'tournament.modules_updated',
        entity: 'Tournament',
        entityId: id,
        before: before.modulesJson,
        after: modules,
      });
      return updated;
    });
  }
}
