import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  confirmDocumentSchema,
  confirmUploadSchema,
  documentUploadRequestSchema,
  createPlayerSchema,
  photoUploadRequestSchema,
  sportProfileSchema,
  updatePlayerSchema,
  type CreatePlayer,
  type DocumentType,
  type UpdatePlayer,
} from '@force-pulse/shared';
import { type AuthUser, CurrentUser, Public } from '../auth/auth.guard';
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

  @Post(':id/documents')
  @ApiBody({ schema: apiSchema(documentUploadRequestSchema) })
  @ApiCreatedResponse({
    description: 'Signed upload URL (5 minutes) for a JPEG, PNG or PDF under 5 MB',
  })
  documentTicket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(documentUploadRequestSchema)) body: { contentType: string },
  ) {
    return this.players.documentUploadTicket(user.id, id, body.contentType);
  }

  @Put(':id/documents')
  @ApiBody({ schema: apiSchema(confirmDocumentSchema) })
  @ApiOkResponse({ description: 'Uploaded ID checked and saved (replaces the same type)' })
  confirmDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(confirmDocumentSchema)) body: { type: DocumentType; key: string },
  ) {
    return this.players.confirmDocument(user.id, id, body.type, body.key);
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'ID document and its file removed' })
  removeDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.players.removeDocument(user.id, id, documentId);
  }

  @Public()
  @Get(':id')
  @ApiOkResponse({ description: 'Public player page: public fields only, works signed out' })
  @ApiNotFoundResponse()
  publicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.players.publicProfile(id);
  }

  @Get(':id/private')
  @ApiOkResponse({
    description:
      'Full profile incl. contact and ID (5-minute links). Every ID view is audit-logged.',
  })
  @ApiForbiddenResponse({ description: 'Only organizers of a tournament this player entered' })
  privateProfile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.players.privateProfile(user.id, id);
  }
}
