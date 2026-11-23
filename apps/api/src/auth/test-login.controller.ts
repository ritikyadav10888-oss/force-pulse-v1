import { Body, Controller, HttpCode, NotFoundException, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './auth.guard';
import { AuthService } from './auth.service';
import { setAuthCookies } from './cookies';

/** Seeded users can't use Google, so dev and test need a way in. Never available in production. */
export const testLoginEnabled = () =>
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

const testLoginSchema = z.object({ email: z.email() });

@ApiExcludeController()
@Public()
@Controller('auth')
export class TestLoginController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Post('test-login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(testLoginSchema)) body: { email: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    // Second lock: the module only registers this controller outside production, and the handler
    // re-checks at request time in case NODE_ENV changed after boot.
    if (!testLoginEnabled()) throw new NotFoundException();
    const user = await this.prisma.user.findFirst({
      where: { email: body.email, deletedAt: null },
    });
    if (!user) throw new NotFoundException('No such seeded user');
    const { accessToken, refreshToken } = await this.auth.issueFor(user.id);
    setAuthCookies(res, accessToken, refreshToken);
    return { userId: user.id };
  }
}
