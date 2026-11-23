import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AUTH_PROVIDER, GoogleAuthProvider } from './auth.provider';
import { AuthService } from './auth.service';
import { ConsentGuard } from './consent';
import { TournamentPermissionGuard } from './roles.guard';
import { testLoginEnabled, TestLoginController } from './test-login.controller';
import { IpThrottlerGuard, throttlerOptions } from './throttle';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({ useFactory: throttlerOptions }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set (32+ chars)');
        return {
          secret,
          signOptions: { algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  // Test-only sign-in is registered only in development/test, so production has no such route.
  controllers: [AuthController, ...(testLoginEnabled() ? [TestLoginController] : [])],
  providers: [
    AuthService,
    TournamentPermissionGuard,
    { provide: AUTH_PROVIDER, useClass: GoogleAuthProvider },
    // Global guards run in this order: rate limit → authenticate → consent.
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ConsentGuard },
  ],
  exports: [TournamentPermissionGuard],
})
export class AuthModule {}
