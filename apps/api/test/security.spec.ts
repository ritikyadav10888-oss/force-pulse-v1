import { createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POLICY_VERSION } from '@force-pulse/shared';
import { seed } from '../src/seed';
import { bootApp, cookieHeader, createTournament, credentialFor, resetDb, signIn } from './helpers';

// Needs DATABASE_URL. Wipes the database.
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let ownerA: Awaited<ReturnType<typeof signIn>>;
let ownerB: Awaited<ReturnType<typeof signIn>>;
let tA: string; // owned by ownerA
let tB: string; // owned by ownerB

const profile = { displayName: 'Ravi Kumar', dob: '1998-01-20', gender: 'male', city: 'Indore' };

beforeAll(async () => {
  await resetDb(prisma);
  await seed(prisma);
  app = await bootApp();
  http = app.getHttpServer();
  ownerA = await signIn(app, { sub: 'owner-a' });
  ownerB = await signIn(app, { sub: 'owner-b' });
  tA = (await createTournament(app, ownerA, 'cricket')).id;
  tB = (await createTournament(app, ownerB, 'football')).id;
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
  const modules = { registration: true, auction: true, scoring: false, fantasy: false };

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

  it('a player calling organizer endpoints gets 403', async () => {
    const p = await signIn(app, { sub: 'plain-player' });
    await request(http).post('/players').set('Cookie', p.cookie).send(profile).expect(201);
    const reg = await request(http)
      .post(`/tournaments/${tA}/registrations`)
      .set('Cookie', p.cookie)
      .expect(201);
    await request(http).get(`/tournaments/${tA}/registrations`).set('Cookie', p.cookie).expect(403);
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', p.cookie)
      .send({ status: 'approved' })
      .expect(403);
    await request(http)
      .patch(`/tournaments/${tA}/registration`)
      .set('Cookie', p.cookie)
      .send({ open: false })
      .expect(403);
    await request(http)
      .patch(`/tournaments/${tA}/modules`)
      .set('Cookie', p.cookie)
      .send(modules)
      .expect(403);
  });

  it("owner A gets 403 on owner B's tournament", async () => {
    const p = await signIn(app, { sub: 'b-player' });
    await request(http).post('/players').set('Cookie', p.cookie).send(profile).expect(201);
    const reg = await request(http)
      .post(`/tournaments/${tB}/registrations`)
      .set('Cookie', p.cookie)
      .expect(201);
    await request(http)
      .get(`/tournaments/${tB}/registrations`)
      .set('Cookie', ownerA.cookie)
      .expect(403);
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', ownerA.cookie)
      .send({ status: 'approved' })
      .expect(403);
    await request(http)
      .patch(`/tournaments/${tB}/registration`)
      .set('Cookie', ownerA.cookie)
      .send({ open: false })
      .expect(403);
    await request(http)
      .patch(`/tournaments/${tB}/modules`)
      .set('Cookie', ownerA.cookie)
      .send(modules)
      .expect(403);
  });

  it('a co-organizer runs players but gets 403 on owner-only actions', async () => {
    const co = await signIn(app, { sub: 'co-a' });
    await prisma.membership.create({
      data: {
        userId: co.userId,
        tournamentId: tA,
        role: 'co_organizer',
        invitedById: ownerA.userId,
      },
    });
    await request(http)
      .get(`/tournaments/${tA}/registrations`)
      .set('Cookie', co.cookie)
      .expect(200);
    await request(http)
      .patch(`/tournaments/${tA}/registration`)
      .set('Cookie', co.cookie)
      .send({ open: true })
      .expect(200);
    await request(http)
      .patch(`/tournaments/${tA}/modules`)
      .set('Cookie', co.cookie)
      .send(modules)
      .expect(403);
    // The owner can.
    const res = await request(http)
      .patch(`/tournaments/${tA}/modules`)
      .set('Cookie', ownerA.cookie)
      .send(modules)
      .expect(200);
    expect(res.body.modulesJson).toEqual(modules);
    // Co-organizer rights don't carry over to another tournament.
    await request(http)
      .get(`/tournaments/${tB}/registrations`)
      .set('Cookie', co.cookie)
      .expect(403);
  });

  it('super admins run the platform, not tournaments', async () => {
    const admin = await signIn(app, { sub: 'super', email: 'admin@example.com' });
    await request(http)
      .get(`/tournaments/${tA}/registrations`)
      .set('Cookie', admin.cookie)
      .expect(403);
  });

  it('returns 404 for unknown ids and 400 for malformed ones', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    await request(http)
      .patch(`/registrations/${unknown}`)
      .set('Cookie', ownerA.cookie)
      .send({ status: 'approved' })
      .expect(404);
    await request(http)
      .get(`/tournaments/${unknown}/registrations`)
      .set('Cookie', ownerA.cookie)
      .expect(404);
    await request(http)
      .get('/tournaments/not-a-uuid/registrations')
      .set('Cookie', ownerA.cookie)
      .expect(400);
  });
});

describe('test-only sign-in', () => {
  it('signs in as a seeded user in test mode', async () => {
    const seeded = await prisma.user.create({
      data: { googleSub: 'seed:x', email: 'seeded@demo.test', name: 'Seeded' },
    });
    const res = await request(http)
      .post('/auth/test-login')
      .send({ email: 'seeded@demo.test' })
      .expect(200);
    expect(res.body.userId).toBe(seeded.id);
    const me = await request(http).get('/me').set('Cookie', cookieHeader(res)).expect(200);
    expect(me.body.user.email).toBe('seeded@demo.test');
    await request(http).post('/auth/test-login').send({ email: 'nobody@demo.test' }).expect(404);
  });

  it('does not exist in production mode', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules(); // re-evaluate module registration with the production env
    try {
      const { AppModule } = await import('../src/app.module.js');
      const prod = (
        await Test.createTestingModule({ imports: [AppModule] }).compile()
      ).createNestApplication();
      await prod.init();
      await request(prod.getHttpServer())
        .post('/auth/test-login')
        .send({ email: 'seeded@demo.test' })
        .expect(404);
      await prod.close();
    } finally {
      process.env.NODE_ENV = previous;
      vi.resetModules();
    }
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
    // Built at runtime (no token literal in the repo, which secret scanners flag).
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const s = await signIn(app, { sub: 'forge-target' });
    const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: s.userId })}`;
    const sig = createHmac('sha256', randomBytes(32)).update(body).digest('base64url');
    await request(http).get('/me').set('Authorization', `Bearer ${body}.${sig}`).expect(401);
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
