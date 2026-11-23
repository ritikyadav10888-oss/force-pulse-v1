import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { POLICY_VERSION } from '@force-pulse/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AUTH_PROVIDER, type VerifiedIdentity } from '../src/auth/auth.provider';
import { FileStorage, type StoredObject } from '../src/storage/storage';

/** Test credential = the identity as JSON; the fake provider trusts it (Google is not called in tests). */
export const credentialFor = (id: Partial<VerifiedIdentity> & { sub: string }) =>
  JSON.stringify({ email: `${id.sub}@example.com`, emailVerified: true, name: id.sub, ...id });

/** In-memory stand-in for Cloud Storage; tests "upload" with put(). */
export class MemoryStorage extends FileStorage {
  readonly objects = new Map<string, StoredObject>();
  put(key: string, obj: StoredObject) {
    this.objects.set(key, obj);
  }
  async presignUpload(key: string, contentType: string, maxBytes: number) {
    return {
      url: `https://storage.test/upload/${key}`,
      headers: { 'Content-Type': contentType, 'x-goog-content-length-range': `0,${maxBytes}` },
    };
  }
  async presignDownload(key: string, ttlSeconds: number) {
    return `https://storage.test/download/${key}?ttl=${ttlSeconds}`;
  }
  async stat(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
export const storage = new MemoryStorage();

export async function bootApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUTH_PROVIDER)
    .useValue({ verify: async (c: string) => JSON.parse(c) as VerifiedIdentity })
    .overrideProvider(FileStorage)
    .useValue(storage)
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

/** Signs in and (unless consent: false) accepts the privacy policy, like a real first-time user. */
export async function signIn(
  app: INestApplication,
  id: Parameters<typeof credentialFor>[0],
  { consent = true }: { consent?: boolean } = {},
) {
  const res = await request(app.getHttpServer())
    .post('/auth/google')
    .send({ credential: credentialFor(id) })
    .expect(200);
  const cookie = cookieHeader(res);
  if (consent) {
    await request(app.getHttpServer())
      .post('/me/consent')
      .set('Cookie', cookie)
      .send({ policyVersion: POLICY_VERSION, scopes: ['data_use'] })
      .expect(200);
  }
  return { cookie, userId: res.body.userId as string };
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, invites, registrations, player_documents, player_sport_profiles, players,
     memberships, consents, refresh_tokens, users, tournaments, events, rule_packs, sports CASCADE`,
  );
}

const modulesOn = { registration: true, auction: false, scoring: false, fantasy: false };

/** Creates an event + tournament as `owner` (who becomes its owner), optionally opening registration. */
export async function createTournament(
  app: INestApplication,
  owner: { cookie: string },
  sportCode: string,
  { modules = modulesOn, open = true }: { modules?: typeof modulesOn; open?: boolean } = {},
) {
  const http = app.getHttpServer();
  const event = await request(http)
    .post('/events')
    .set('Cookie', owner.cookie)
    .send({
      name: `${sportCode} fest`,
      orgName: 'Test Org',
      startDate: '2027-02-01',
      endDate: '2027-02-05',
    })
    .expect(201);
  const t = await request(http)
    .post(`/events/${event.body.id}/tournaments`)
    .set('Cookie', owner.cookie)
    .send({
      sportCode,
      name: `${sportCode} cup`,
      category: 'Open',
      entryType: 'individual',
      modules,
    })
    .expect(201);
  if (open && modules.registration) {
    await request(http)
      .patch(`/tournaments/${t.body.id}/registration`)
      .set('Cookie', owner.cookie)
      .send({ open: true })
      .expect(200);
  }
  return { eventId: event.body.id as string, id: t.body.id as string };
}
