import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import {
  createEventSchema,
  createTournamentSchema,
  type CreateEvent,
  type CreateTournament,
} from '@force-pulse/shared';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { audit } from '../common/audit';
import { apiSchema, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const semverKey = (v: string) =>
  v
    .split('.')
    .map((n) => n.padStart(6, '0'))
    .join('.');

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @ApiBody({ schema: apiSchema(createEventSchema) })
  @ApiCreatedResponse({ description: 'Event created; any signed-in user can create one' })
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createEventSchema)) body: CreateEvent) {
    return this.prisma.event.create({
      data: {
        name: body.name,
        orgName: body.orgName,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        createdById: user.id,
      },
    });
  }

  @Post(':id/tournaments')
  @ApiBody({ schema: apiSchema(createTournamentSchema) })
  @ApiCreatedResponse({
    description:
      "Tournament created in your event; you become its owner. Pins the sport's current rule pack.",
  })
  async addTournament(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(createTournamentSchema)) body: CreateTournament,
  ) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.createdById !== user.id)
      throw new ForbiddenException('Only the event creator can add tournaments');

    const packs = await this.prisma.rulePack.findMany({
      where: { sport: { code: body.sportCode } },
      select: { id: true, version: true, sportId: true },
    });
    const pack = packs.sort((a, b) => semverKey(b.version).localeCompare(semverKey(a.version)))[0];
    if (!pack) throw new NotFoundException(`Unknown sport "${body.sportCode}"`);

    return this.prisma.$transaction(async (tx) => {
      const t = await tx.tournament.create({
        data: {
          eventId,
          sportId: pack.sportId,
          rulePackId: pack.id,
          name: body.name,
          category: body.category,
          entryType: body.entryType,
          genderRule: body.genderRule,
          ageMin: body.ageMin,
          ageMax: body.ageMax,
          registrationDeadline: body.registrationDeadline
            ? new Date(body.registrationDeadline)
            : undefined,
          // Registration starts closed; the organizer opens it when ready.
          registrationOpen: false,
          modulesJson: body.modules,
          createdById: user.id,
        },
      });
      await tx.membership.create({ data: { userId: user.id, tournamentId: t.id, role: 'owner' } });
      await audit(tx, {
        actorId: user.id,
        action: 'tournament.created',
        entity: 'Tournament',
        entityId: t.id,
        after: { name: t.name, modules: body.modules },
      });
      return t;
    });
  }
}
