import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../src/seed';
import { bootApp, cookieHeader, createTournament, resetDb, signIn } from './helpers';

// Needs DATABASE_URL (CI Postgres service, or `pnpm db:up` locally). Wipes the database.
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;

const profile = { displayName: 'Asha Patel', dob: '2000-04-02', gender: 'female', city: 'Pune' };
const registrationOff = { registration: false, auction: true, scoring: true, fantasy: false };

beforeAll(async () => {
  await resetDb(prisma);
  await seed(prisma);
  await seed(prisma); // idempotent
  app = await bootApp();
  http = app.getHttpServer();
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
});

describe('creator is the owner', () => {
  it('lets any signed-in user create an event with two tournaments and own them, no approval', async () => {
    const owner = await signIn(app, { sub: 'creator' });
    const cricket = await createTournament(app, owner, 'cricket', { open: false });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: cricket.eventId } });
    const football = await request(http)
      .post(`/events/${event.id}/tournaments`)
      .set('Cookie', owner.cookie)
      .send({
        sportCode: 'football',
        name: 'Football league',
        category: "Women's open",
        entryType: 'team',
        modules: registrationOff,
      })
      .expect(201);

    const mine = await request(http).get('/me/tournaments').set('Cookie', owner.cookie).expect(200);
    expect(mine.body).toHaveLength(2);
    for (const t of mine.body) expect(t.roles).toEqual(['owner']);
    expect(mine.body.find((t: { id: string }) => t.id === football.body.id).modules).toEqual(
      registrationOff,
    );

    const pinned = await prisma.tournament.findUniqueOrThrow({
      where: { id: cricket.id },
      include: { rulePack: true },
    });
    expect(pinned).toMatchObject({ registrationOpen: false, createdById: owner.userId });
    expect(pinned.rulePack.version).toBe('1.0.0');
  });

  it('only the event creator adds tournaments; unknown sports 404', async () => {
    const owner = await signIn(app, { sub: 'event-maker' });
    const other = await signIn(app, { sub: 'event-crasher' });
    const { eventId } = await createTournament(app, owner, 'chess');
    const body = {
      sportCode: 'chess',
      name: 'Blitz',
      category: 'Open',
      entryType: 'individual',
      modules: registrationOff,
    };
    await request(http)
      .post(`/events/${eventId}/tournaments`)
      .set('Cookie', other.cookie)
      .send(body)
      .expect(403);
    await request(http)
      .post(`/events/${eventId}/tournaments`)
      .set('Cookie', owner.cookie)
      .send({ ...body, sportCode: 'curling' })
      .expect(404);
  });

  it('the database allows exactly one owner per tournament', async () => {
    const owner = await signIn(app, { sub: 'only-owner' });
    const usurper = await signIn(app, { sub: 'usurper' });
    const { id } = await createTournament(app, owner, 'kabaddi');
    await expect(
      prisma.membership.create({
        data: { userId: usurper.userId, tournamentId: id, role: 'owner' },
      }),
    ).rejects.toThrow(/Unique constraint/);
    // Other roles can coexist with the owner, including on the same person.
    await prisma.membership.create({
      data: { userId: usurper.userId, tournamentId: id, role: 'co_organizer' },
    });
  });
});

describe('registration on: register → organizer reviews', () => {
  it('runs end to end', async () => {
    const owner = await signIn(app, { sub: 'owner-1' });
    const cricket = await createTournament(app, owner, 'cricket');
    const football = await createTournament(app, owner, 'football');

    const player = await signIn(app, { sub: 'player-1' });
    await request(http)
      .post(`/tournaments/${cricket.id}/registrations`)
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

    const reg = await request(http)
      .post(`/tournaments/${cricket.id}/registrations`)
      .set('Cookie', player.cookie)
      .expect(201);
    expect(reg.body).toMatchObject({
      status: 'pending',
      source: 'self_registered',
      selfApproved: false,
    });
    await request(http)
      .post(`/tournaments/${cricket.id}/registrations`)
      .set('Cookie', player.cookie)
      .expect(409);
    const reg2 = await request(http)
      .post(`/tournaments/${football.id}/registrations`)
      .set('Cookie', player.cookie)
      .expect(201);

    const queue = await request(http)
      .get(`/tournaments/${cricket.id}/registrations?status=pending`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(queue.body.map((r: { player: { id: string } }) => r.player.id)).toContain(
      created.body.id,
    );

    await request(http)
      .patch(`/registrations/${reg2.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'rejected' })
      .expect(400);
    await request(http)
      .patch(`/registrations/${reg2.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'rejected', reason: 'Upload a clearer photo' })
      .expect(200);
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'approved' })
      .expect(200);

    const mine = await request(http)
      .get('/me/registrations')
      .set('Cookie', player.cookie)
      .expect(200);
    const status = Object.fromEntries(
      mine.body.map((r: { id: string; status: string }) => [r.id, r]),
    );
    expect(status[reg.body.id]).toMatchObject({ status: 'approved' });
    expect(status[reg2.body.id]).toMatchObject({
      status: 'rejected',
      reason: 'Upload a clearer photo',
    });

    // Approval makes them a member with role player.
    const theirs = await request(http)
      .get('/me/tournaments')
      .set('Cookie', player.cookie)
      .expect(200);
    expect(theirs.body).toEqual([expect.objectContaining({ id: cricket.id, roles: ['player'] })]);

    // Rejected players can resubmit.
    const again = await request(http)
      .post(`/tournaments/${football.id}/registrations`)
      .set('Cookie', player.cookie)
      .expect(201);
    expect(again.body).toMatchObject({ id: reg2.body.id, status: 'pending', reason: null });

    const logs = await prisma.auditLog.findMany({
      where: { entity: 'Registration' },
      orderBy: { at: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual(['registration.rejected', 'registration.approved']);
    expect(logs[0]!.actorId).toBe(owner.userId);
  });

  it('refuses registration when closed or when the registration module is off', async () => {
    const owner = await signIn(app, { sub: 'owner-closed' });
    const closed = await createTournament(app, owner, 'basketball', { open: false });
    const off = await createTournament(app, owner, 'badminton', { modules: registrationOff });
    const p = await signIn(app, { sub: 'player-late' });
    await request(http).post('/players').set('Cookie', p.cookie).send(profile).expect(201);
    await request(http)
      .post(`/tournaments/${closed.id}/registrations`)
      .set('Cookie', p.cookie)
      .expect(400);
    const res = await request(http)
      .post(`/tournaments/${off.id}/registrations`)
      .set('Cookie', p.cookie)
      .expect(400);
    expect(res.body.message).toMatch(/adds players directly/);
    // Can't open registration while the module is off.
    await request(http)
      .patch(`/tournaments/${off.id}/registration`)
      .set('Cookie', owner.cookie)
      .send({ open: true })
      .expect(400);
  });
});

describe('owner who also plays', () => {
  it('flags self-approval, shows it in the queue and audit log; co-organizer approval is not self', async () => {
    const owner = await signIn(app, { sub: 'playing-owner' });
    const { id } = await createTournament(app, owner, 'football');
    await request(http).post('/players').set('Cookie', owner.cookie).send(profile).expect(201);
    const reg = await request(http)
      .post(`/tournaments/${id}/registrations`)
      .set('Cookie', owner.cookie)
      .expect(201);

    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'approved' })
      .expect(200);
    const queue = await request(http)
      .get(`/tournaments/${id}/registrations`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(queue.body.find((r: { id: string }) => r.id === reg.body.id)).toMatchObject({
      selfApproved: true,
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: reg.body.id } });
    expect(log).toMatchObject({ action: 'registration.self_approved', actorId: owner.userId });

    const mine = await request(http).get('/me/tournaments').set('Cookie', owner.cookie).expect(200);
    expect(mine.body.find((t: { id: string }) => t.id === id).roles.sort()).toEqual([
      'owner',
      'player',
    ]);

    // A co-organizer approving the owner's registration is not a self-approval.
    const helper = await signIn(app, { sub: 'helper' });
    await prisma.membership.create({
      data: { userId: helper.userId, tournamentId: id, role: 'co_organizer' },
    });
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', helper.cookie)
      .send({ status: 'approved' })
      .expect(200);
    expect(
      await prisma.registration.findUniqueOrThrow({ where: { id: reg.body.id } }),
    ).toMatchObject({
      selfApproved: false,
    });
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

  it('makes verified SUPER_ADMIN_EMAILS super admins, but never unverified ones', async () => {
    const admin = await signIn(app, { sub: 'platform-admin', email: 'admin@example.com' });
    const fake = await signIn(app, {
      sub: 'impostor',
      email: 'admin@example.com',
      emailVerified: false,
    });
    const me = await request(http).get('/me').set('Cookie', admin.cookie).expect(200);
    expect(me.body.user.isSuperAdmin).toBe(true);
    const fakeMe = await request(http).get('/me').set('Cookie', fake.cookie).expect(200);
    expect(fakeMe.body.user.isSuperAdmin).toBe(false);
  });
});
