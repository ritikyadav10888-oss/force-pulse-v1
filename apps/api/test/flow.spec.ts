import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../src/seed';
import { bootApp, cookieHeader, resetDb, signIn } from './helpers';

// Needs DATABASE_URL (CI Postgres service, or `pnpm db:up` locally). Wipes the database.
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let cricketId: string;
let footballId: string;

const profile = { displayName: 'Asha Patel', dob: '2000-04-02', gender: 'female', city: 'Pune' };

beforeAll(async () => {
  await resetDb(prisma);
  await seed(prisma);
  await seed(prisma); // idempotent
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

describe('seed and sports', () => {
  it('lists the six sports and serves the current pack', async () => {
    const sports = await request(http).get('/sports').expect(200);
    expect(sports.body).toHaveLength(6);
    const pack = await request(http).get('/sports/cricket/rule-packs/current').expect(200);
    expect(pack.body.version).toBe('1.0.0');
    expect(pack.body.pack.registration.fields.map((f: { key: string }) => f.key)).toContain(
      'bowlingStyle',
    );
    await request(http).get('/sports/curling/rule-packs/current').expect(404);
  });

  it('pins tournaments to a pack version', async () => {
    const t = await prisma.tournament.findUniqueOrThrow({
      where: { id: cricketId },
      include: { rulePack: true },
    });
    expect(t.rulePack.version).toBe('1.0.0');
  });
});

describe('walking skeleton: sign in → profile → register → organizer reviews', () => {
  it('runs end to end', async () => {
    const player = await signIn(app, { sub: 'player-1' });
    const me0 = await request(http).get('/me').set('Cookie', player.cookie).expect(200);
    expect(me0.body.player).toBeNull();

    await request(http)
      .post(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', player.cookie)
      .expect(400);
    await request(http)
      .post('/players')
      .set('Cookie', player.cookie)
      .send({ ...profile, dob: 'yesterday' })
      .expect(400);
    const created = await request(http)
      .post('/players')
      .set('Cookie', player.cookie)
      .send(profile)
      .expect(201);
    await request(http).post('/players').set('Cookie', player.cookie).send(profile).expect(409);

    const list = await request(http).get('/tournaments').expect(200);
    expect(list.body.map((t: { id: string }) => t.id)).toEqual(
      expect.arrayContaining([cricketId, footballId]),
    );

    const reg = await request(http)
      .post(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', player.cookie)
      .expect(201);
    expect(reg.body.status).toBe('pending');
    await request(http)
      .post(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', player.cookie)
      .expect(409);
    await request(http)
      .post(`/tournaments/${footballId}/registrations`)
      .set('Cookie', player.cookie)
      .expect(201);

    // A player calling an organizer endpoint gets 403.
    await request(http)
      .get(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', player.cookie)
      .expect(403);
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', player.cookie)
      .send({ status: 'approved' })
      .expect(403);

    // Bootstrap admin (SUPER_ADMIN_EMAILS in vitest config) reviews.
    const admin = await signIn(app, { sub: 'admin-1', email: 'admin@example.com' });
    const queue = await request(http)
      .get(`/tournaments/${cricketId}/registrations?status=pending`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(queue.body.map((r: { player: { id: string } }) => r.player.id)).toContain(
      created.body.id,
    );

    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', admin.cookie)
      .send({ status: 'rejected' })
      .expect(400);
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', admin.cookie)
      .send({ status: 'rejected', reason: 'Upload a clearer photo' })
      .expect(200);

    const mine = await request(http)
      .get('/me/registrations')
      .set('Cookie', player.cookie)
      .expect(200);
    expect(mine.body.find((r: { id: string }) => r.id === reg.body.id)).toMatchObject({
      status: 'rejected',
      reason: 'Upload a clearer photo',
    });

    // Rejected players can resubmit; then the organizer approves.
    const again = await request(http)
      .post(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', player.cookie)
      .expect(201);
    expect(again.body).toMatchObject({ id: reg.body.id, status: 'pending', reason: null });
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', admin.cookie)
      .send({ status: 'approved' })
      .expect(200);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: reg.body.id },
      orderBy: { at: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual(['registration.rejected', 'registration.approved']);
    expect(logs[0]!.actorId).toBe(admin.userId);
  });

  it('scopes organizer rights to their own tournament', async () => {
    const org = await signIn(app, { sub: 'organizer-1' });
    await prisma.membership.create({
      data: { userId: org.userId, tournamentId: footballId, role: 'organizer' },
    });
    await request(http)
      .get(`/tournaments/${footballId}/registrations`)
      .set('Cookie', org.cookie)
      .expect(200);
    await request(http)
      .get(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', org.cookie)
      .expect(403);
  });

  it('does not make unverified emails admins', async () => {
    const fake = await signIn(app, {
      sub: 'impostor',
      email: 'admin@example.com',
      emailVerified: false,
    });
    await request(http)
      .get(`/tournaments/${cricketId}/registrations`)
      .set('Cookie', fake.cookie)
      .expect(403);
  });

  it('refuses registration when closed', async () => {
    const p = await signIn(app, { sub: 'player-late' });
    await request(http).post('/players').set('Cookie', p.cookie).send(profile).expect(201);
    await prisma.tournament.update({
      where: { id: footballId },
      data: { registrationOpen: false },
    });
    await request(http)
      .post(`/tournaments/${footballId}/registrations`)
      .set('Cookie', p.cookie)
      .expect(400);
    await prisma.tournament.update({ where: { id: footballId }, data: { registrationOpen: true } });
  });
});

describe('sessions', () => {
  it('rejects anonymous calls to protected routes', async () => {
    await request(http).get('/me').expect(401);
    await request(http).get('/me').set('Cookie', 'fp_at=garbage').expect(401);
  });

  it('rotates refresh tokens and treats reuse as theft', async () => {
    const s = await signIn(app, { sub: 'rotator' });
    const r1 = await request(http).post('/auth/refresh').set('Cookie', s.cookie).expect(204);
    const next = cookieHeader(r1);
    expect(next).toContain('fp_rt=');
    expect(next).not.toBe(s.cookie);
    await request(http).get('/me').set('Cookie', next).expect(200);

    // Replaying the old refresh token fails and revokes the new one too.
    await request(http).post('/auth/refresh').set('Cookie', s.cookie).expect(401);
    await request(http).post('/auth/refresh').set('Cookie', next).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const s = await signIn(app, { sub: 'leaver' });
    await request(http).post('/auth/logout').set('Cookie', s.cookie).expect(204);
    await request(http).post('/auth/refresh').set('Cookie', s.cookie).expect(401);
  });

  it('sets httpOnly, SameSite=Lax session cookies', async () => {
    const res = await request(http)
      .post('/auth/google')
      .send({
        credential: JSON.stringify({ sub: 'c', email: 'c@x.io', name: 'c', emailVerified: true }),
      });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) expect(c).toMatch(/HttpOnly/i);
    for (const c of cookies) expect(c).toMatch(/SameSite=Lax/i);
  });
});
