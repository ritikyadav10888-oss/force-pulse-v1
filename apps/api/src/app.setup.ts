import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

// Shared by main.ts and integration tests so tests run the same app as production.
export function configureApp(app: INestApplication) {
  app.useLogger(app.get(Logger));
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  });

  const config = new DocumentBuilder().setTitle('Force Pulse API').setVersion('0.1.0').build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
