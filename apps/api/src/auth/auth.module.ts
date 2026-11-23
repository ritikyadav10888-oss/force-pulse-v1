import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AUTH_PROVIDER, GoogleAuthProvider } from './auth.provider';
import { AuthService } from './auth.service';
import { TournamentRolesGuard } from './roles.guard';

@Module({
  imports: [
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
  controllers: [AuthController],
  providers: [
    AuthService,
    TournamentRolesGuard,
    { provide: AUTH_PROVIDER, useClass: GoogleAuthProvider },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TournamentRolesGuard],
})
export class AuthModule {}
