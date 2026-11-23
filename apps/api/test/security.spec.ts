import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POLICY_VERSION } from '@force-pulse/shared';
import { seed } from '../src/seed';
import { bootApp, credentialFor, resetDb, signIn } from './helpers';

// Needs DATABASE_URL. Wipes the database.
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let cricketId: string;
let footballId: string;

const profile = { displayName: 'Ravi Kumar', dob: '1998-01-20', gender: 'male', city: 'Indore' };

beforeAll(async () => {
  await resetDb(prisma);
  await seed(prisma);
  app = await bootApp();
  http = app.getHttpServer();
  const ts = await prisma.tournament.findMany({ include: { sport: true } });
  cricketId = ts.find((t) => t.sport.code === 'cricket')!.id;
  footballId = ts.find((t) => t.sport.code === 'football')!.id;
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('consent', () => {
  it('blocks everything but /me and consent until data use is accepted', async () => {
    const s = await signIn(app, { sub: 'new-user' }, { consent: false });
    const me = await request(http).get('/me').set('Cookie', s.cookie).expect(200);
    expect(me.body.consent).toEqual({ policyVersion: POLICY_VERSION, scopes: [], required: true });

    const blocked = await request(http)
      .post('/players')
      .set('Cookie', s.cookie)
      .send(profile)
      .expect(403);
    expect(blocked.body.code).toBe('consent_required');
    await request(http).get('/me/registrations').set('Cookie', s.cookie).expect(403);
    // Public routes stay open.
    await request(http).get('/tournaments').set('Cookie', s.cookie).expect(200);
  });

  it('requires data_use and the current policy version', async () => {
    const s = await signIn(app, { sub: 'picky-user' }, { consent: false });
    const send = (body: object) =>
      request(http).post('/me/consent').set('Cookie', s.cookie).send(body);
    await send({ policyVersion: POLICY_VERSION, scopes: ['photos_on_streams'] }).expect(400);
    await send({ policyVersion: '2000-01-01', scopes: ['data_use'] }).expect(400);
    await send({ policyVersion: POLICY_VERSION, scopes: ['data_use', 'sell_my_data'] }).expect(400);

    await send({ policyVersion: POLICY_VERSION, scopes: ['data_use', 'photos_on_streams'] }).expect(
      200,
    );
    await send({ policyVersion: POLICY_VERSION, scopes: ['data_use'] }).expect(200); // idempotent
    const me = await request(http).get('/me').set('Cookie', s.cookie).expect(200);
    expect(me.body.consent).toMatchObject({ required: false });
    expect(me.body.consent.scopes.sort()).toEqual(['data_use', 'photos_on_streams']);
    expect(await prisma.consent.count({ where: { userId: s.userId } })).toBe(2);

    await request(http).post('/players').set('Cookie', s.cookie).send(profile).expect(201);
  });
});

describe('role checks (403)', () => {
  it('stops players editing someone else’s profile', async () => {
    const a = await signIn(app, { sub: 'owner' });
    const b = await signIn(app, { sub: 'intruder' });
    const created = await request(http)
      .post('/players')
      .set('Cookie', a.cookie)
      .send(profile)
      .expect(201);
    await request(http)
      .patch(`/players/${created.body.id}`)
      .set('Cookie', b.cookie)
      .send({ city: 'Hacked' })
      .expect(403);
    await request(http)
      .patch(`/players/${created.body.id}`)
      .set('Cookie', a.cookie)
      .send({ city: 'Bhopal' })
      .expect(200);
  });

  it('keeps organizers to their own tournament for reviews too', async () => {
    const p = await signIn(app, { sub: 'reg-player' });
    await request(http).post('/players').set('Cookie', p.cookie).send(profile).expect(201);
    const reg = await request(http)
      .post(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', p.cookie)
      .expect(201);

    const org = await signIn(app, { sub: 'football-org' });
    await prisma.membership.create({
      data: { userId: org.userId, tournamentId: footballId, role: 'organizer' },
    });
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', org.cookie)
      .send({ status: 'approved' })
      .expect(403);

    // Non-organizer roles in the right tournament are not enough either.
    const scorer = await signIn(app, { sub: 'cricket-scorer' });
    await prisma.membership.create({
      data: { userId: scorer.userId, tournamentId: cricketId, role: 'scorer' },
    });
    await request(http)
      .get(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', scorer.cookie)
      .expect(403);
  });

  it('returns 404 for unknown registrations and 400 for malformed ids', async () => {
    const admin = await signIn(app, { sub: 'admin-2', email: 'admin@example.com' });
    await request(http)
      .patch('/registrations/00000000-0000-4000-8000-000000000000')
      .set('Cookie', admin.cookie)
      .send({ status: 'approved' })
      .expect(404);
    await request(http)
      .get('/tournaments/not-a-uuid/registrations')
      .set('Cookie', admin.cookie)
      .expect(400);
  });
});

describe('sessions', () => {
  it('logout clears both cookies', async () => {
    const s = await signIn(app, { sub: 'cookie-clear' });
    const res = await request(http).post('/auth/logout').set('Cookie', s.cookie).expect(204);
    const cleared = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cleared.map((c) => c.split('=')[0]).sort()).toEqual(['fp_at', 'fp_rt']);
    for (const c of cleared) expect(c).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('rejects tokens signed with another secret', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDAifQ.' +
      'c2lnbmF0dXJlLW5vdC12YWxpZA';
    await request(http).get('/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });
});

describe('rate limits', () => {
  let limited: INestApplication;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT = '3';
    limited = await bootApp();
  });
  afterAll(async () => {
    process.env.AUTH_RATE_LIMIT = '100000';
    await limited.close();
  });

  it('limits /auth/* per client IP and leaves other routes alone', async () => {
    const server = limited.getHttpServer();
    const attempt = (ip: string) =>
      request(server)
        .post('/auth/google')
        .set('X-Forwarded-For', `${ip}, 10.0.0.1`)
        .send({ credential: credentialFor({ sub: `rl-${ip}` }) });

    for (let i = 0; i < 3; i++) await attempt('203.0.113.7').expect(200);
    const blocked = await attempt('203.0.113.7').expect(429);
    expect(blocked.headers['retry-after-auth']).toBeDefined();
    await attempt('198.51.100.9').expect(200); // another client is unaffected
    await request(server).get('/tournaments').set('X-Forwarded-For', '203.0.113.7').expect(200);
  });
});
