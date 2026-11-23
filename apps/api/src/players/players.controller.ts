import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { createPlayerSchema, updatePlayerSchema, type CreatePlayer } from '@force-pulse/shared';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { isUniqueViolation } from '../common/prisma-errors';
import { apiSchema, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const toData = (p: Partial<CreatePlayer>) => ({ ...p, dob: p.dob ? new Date(p.dob) : undefined });

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @ApiBody({ schema: apiSchema(createPlayerSchema) })
  @ApiCreatedResponse({ description: 'Core profile created for the signed-in user' })
  @ApiConflictResponse({ description: 'Profile already exists' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createPlayerSchema)) body: CreatePlayer,
  ) {
    try {
      return await this.prisma.player.create({
        data: { userId: user.id, ...body, dob: new Date(body.dob) },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Profile already exists');
      throw e;
    }
  }

  @Patch(':id')
  @ApiBody({ schema: apiSchema(updatePlayerSchema) })
  @ApiOkResponse({ description: 'Core profile updated (own profile only)' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updatePlayerSchema)) body: Partial<CreatePlayer>,
  ) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      select: { userId: true, deletedAt: true },
    });
    if (!player || player.deletedAt) throw new NotFoundException();
    if (player.userId !== user.id) throw new ForbiddenException();
    return this.prisma.player.update({ where: { id }, data: toData(body) });
  }
}
