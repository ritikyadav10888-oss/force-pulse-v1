import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { googleSignInSchema } from '@force-pulse/shared';
import type { Request, Response } from 'express';
import { apiSchema, ZodPipe } from '../common/zod';
import { Public } from './auth.guard';
import { AuthService } from './auth.service';
import { clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from './cookies';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('google')
  @HttpCode(200)
  @ApiBody({ schema: apiSchema(googleSignInSchema) })
  @ApiOkResponse({
    description: 'Signed in; session cookies set. Creates the account on first sign-in.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid Google ID token' })
  async google(
    @Body(new ZodPipe(googleSignInSchema)) body: { credential: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, accessToken, refreshToken } = await this.auth.signIn(body.credential);
    setAuthCookies(res, accessToken, refreshToken);
    return { userId };
  }

  @Post('refresh')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'New session cookies set (refresh token rotated)' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired, revoked or reused refresh token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { accessToken, refreshToken } = await this.auth.refresh(
        readCookie(req, REFRESH_COOKIE),
      );
      setAuthCookies(res, accessToken, refreshToken);
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Session ended and cookies cleared' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req, REFRESH_COOKIE));
    clearAuthCookies(res);
  }
}
