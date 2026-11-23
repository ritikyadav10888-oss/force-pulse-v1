import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

const semverKey = (v: string) =>
  v
    .split('.')
    .map((n) => n.padStart(6, '0'))
    .join('.');

@ApiTags('sports')
@Public()
@Controller('sports')
export class SportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ description: 'All sports' })
  list() {
    return this.prisma.sport.findMany({
      select: { code: true, name: true, scoringModel: true, isTeamSport: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get(':code/rule-packs/current')
  @ApiOkResponse({
    description: "Latest published rule pack for the sport (drives the sport's form fields)",
  })
  @ApiNotFoundResponse()
  async current(@Param('code') code: string) {
    const packs = await this.prisma.rulePack.findMany({
      where: { sport: { code } },
      select: { version: true, contentJson: true, publishedAt: true },
    });
    const latest = packs.sort((a, b) =>
      semverKey(b.version).localeCompare(semverKey(a.version)),
    )[0];
    if (!latest) throw new NotFoundException();
    return { version: latest.version, publishedAt: latest.publishedAt, pack: latest.contentJson };
  }
}
