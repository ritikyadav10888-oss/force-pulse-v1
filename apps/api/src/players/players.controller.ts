import {
  Body,
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  confirmUploadSchema,
  createPlayerSchema,
  photoUploadRequestSchema,
  sportProfileSchema,
  updatePlayerSchema,
  type CreatePlayer,
  type UpdatePlayer,
} from '@force-pulse/shared';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { isUniqueViolation } from '../common/prisma-errors';
import { apiSchema, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { PlayersService } from './players.service';

const sportCode = (code: string) => code.toLowerCase();

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly players: PlayersService,
  ) {}

  @Post()
  @ApiBody({ schema: apiSchema(createPlayerSchema) })
  @ApiCreatedResponse({
    description: 'Core profile created for the signed-in user (wizard step 1)',
  })
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
  @ApiOkResponse({ description: 'Core profile or contact & safety updated (own profile only)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updatePlayerSchema)) body: UpdatePlayer,
  ) {
    return this.players.update(user.id, id, body);
  }

  @Post(':id/photo')
  @ApiBody({ schema: apiSchema(photoUploadRequestSchema) })
  @ApiCreatedResponse({ description: 'Signed upload URL (5 minutes) for a JPEG/PNG under 5 MB' })
  photoTicket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(photoUploadRequestSchema)) body: { contentType: 'image/jpeg' | 'image/png' },
  ) {
    return this.players.photoUploadTicket(user.id, id, body.contentType);
  }

  @Put(':id/photo')
  @ApiBody({ schema: apiSchema(confirmUploadSchema) })
  @ApiOkResponse({ description: 'Uploaded file checked and set as the profile photo' })
  confirmPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(confirmUploadSchema)) body: { key: string },
  ) {
    return this.players.confirmPhoto(user.id, id, body.key);
  }

  @Post(':id/sport-profiles/:sport')
  @ApiBody({ schema: apiSchema(sportProfileSchema) })
  @ApiCreatedResponse({
    description: "Sport profile added; attributes validated against the sport's current rule pack",
  })
  addSport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sport') sport: string,
    @Body(new ZodPipe(sportProfileSchema)) body: { attributes: Record<string, unknown> },
  ) {
    return this.players.addSportProfile(user.id, id, sportCode(sport), body.attributes);
  }

  @Patch(':id/sport-profiles/:sport')
  @ApiBody({ schema: apiSchema(sportProfileSchema) })
  @ApiOkResponse({
    description: 'Sport profile edited; after an approval this sends it back for review',
  })
  editSport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sport') sport: string,
    @Body(new ZodPipe(sportProfileSchema)) body: { attributes: Record<string, unknown> },
  ) {
    return this.players.editSportProfile(user.id, id, sportCode(sport), body.attributes);
  }

  @Delete(':id/sport-profiles/:sport')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Sport profile removed' })
  removeSport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sport') sport: string,
  ) {
    return this.players.removeSportProfile(user.id, id, sportCode(sport));
  }
}
