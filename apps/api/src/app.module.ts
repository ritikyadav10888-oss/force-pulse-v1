import { Module } from '@nestjs/common';
import { APP_FILTER, HttpAdapterHost } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // JSON in deploys (no TTY); readable output in a local terminal.
        transport: process.stdout.isTTY ? { target: 'pino-pretty' } : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    PrismaModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      // Sentry ships the filter without decorator metadata, so hand it the HTTP adapter explicitly.
      provide: APP_FILTER,
      useFactory: (host: HttpAdapterHost) => new SentryGlobalFilter(host.httpAdapter),
      inject: [HttpAdapterHost],
    },
  ],
})
export class AppModule {}
