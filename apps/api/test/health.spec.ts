import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@force-pulse/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

let app: INestApplication;

async function boot(prismaOverride?: unknown) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (prismaOverride) builder.overrideProvider(PrismaService).useValue(prismaOverride);
  app = (await builder.compile()).createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe('GET /health', () => {
  it('returns 200 when the database answers (needs DATABASE_URL)', async () => {
    const res = await request((await boot()).getHttpServer())
      .get('/health')
      .expect(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      service: 'api',
      checks: { database: 'up' },
    });
  });

  it('returns 503 when the database is down', async () => {
    const res = await request(
      (
        await boot({
          $queryRaw: () => Promise.reject(new Error('no db')),
          $disconnect: async () => {},
        })
      ).getHttpServer(),
    )
      .get('/health')
      .expect(503);
    expect(res.body.checks).toEqual({ database: 'down' });
  });
});

describe('GET /docs-json', () => {
  it('serves the OpenAPI document including /health', async () => {
    const res = await request((await boot()).getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(res.body.paths).toHaveProperty('/health');
  });
});
