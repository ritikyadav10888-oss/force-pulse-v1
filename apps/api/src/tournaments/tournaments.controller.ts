import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  listRegistrationsQuerySchema,
  REGISTRATION_STATUSES,
  reviewRegistrationSchema,
  type RegistrationStatus,
} from '@force-pulse/shared';
import { type AuthUser, CurrentUser, Public } from '../auth/auth.guard';
import { TournamentRoles } from '../auth/roles.guard';
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
  @TournamentRoles(['organizer'])
  @ApiQuery({ name: 'status', required: false, enum: REGISTRATION_STATUSES })
  @ApiOkResponse({ description: 'Approval queue' })
  queue(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(listRegistrationsQuerySchema)) q: { status?: RegistrationStatus },
  ) {
    return this.registrations.list(id, q.status);
  }

  @Patch('registrations/:id')
  @TournamentRoles(['organizer'], 'registration')
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
}
