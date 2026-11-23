import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AUTH_PROVIDER, type VerifiedIdentity } from '../src/auth/auth.provider';

/** Test credential = the identity as JSON; the fake provider trusts it (Google is not called in tests). */
export const credentialFor = (id: Partial<VerifiedIdentity> & { sub: string }) =>
  JSON.stringify({ email: `${id.sub}@example.com`, emailVerified: true, name: id.sub, ...id });

export async function bootApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUTH_PROVIDER)
    .useValue({ verify: async (c: string) => JSON.parse(c) as VerifiedIdentity })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Turns Set-Cookie headers into a Cookie header value. */
export const cookieHeader = (res: request.Response) =>
  ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => !c.endsWith('='))
    .join('; ');

export async function signIn(app: INestApplication, id: Parameters<typeof credentialFor>[0]) {
  const res = await request(app.getHttpServer())
    .post('/auth/google')
    .send({ credential: credentialFor(id) })
    .expect(200);
  return { cookie: cookieHeader(res), userId: res.body.userId as string };
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, registrations, player_documents, player_sport_profiles, players,
     memberships, consents, refresh_tokens, users, tournaments, events, rule_packs, sports CASCADE`,
  );
}
