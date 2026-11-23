import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { PlayersController } from './players/players.controller';
import { PrismaModule } from './prisma/prisma.module';
import { SportsController } from './sports/sports.controller';
import { EventsController } from './tournaments/events.controller';
import { RegistrationsService } from './tournaments/registrations.service';
import { TournamentsController } from './tournaments/tournaments.controller';

@Module({
  imports: [
    SentryModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // JSON in deploys (no TTY); readable output in a local terminal.
        transport: process.stdout.isTTY ? { target: 'pino-pretty' } : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      },
    }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [
    HealthController,
    MeController,
    SportsController,
    PlayersController,
    TournamentsController,
    EventsController,
  ],
  // useClass (Sentry's documented setup): Nest property-injects HttpAdapterHost into the base filter.
  // The startup "no decorator metadata" warning for arg 0 is harmless; a factory breaks HttpException handling.
  providers: [RegistrationsService, { provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class AppModule {}
