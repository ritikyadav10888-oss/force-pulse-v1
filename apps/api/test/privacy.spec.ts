import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../src/seed';
import { bootApp, createTournament, resetDb, signIn, storage } from './helpers';

// Needs DATABASE_URL. Wipes the database.
const prisma = new PrismaClient();
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;

const profile = { displayName: 'Arjun Rao', dob: '1996-08-20', gender: 'male', city: 'Mysuru' };
const contact = { name: 'Kavya Rao', phone: '+91 99000 00000', relation: 'Sister' };

async function newPlayer(sub: string) {
  const s = await signIn(app, { sub });
  const p = await request(http).post('/players').set('Cookie', s.cookie).send(profile).expect(201);
  return { ...s, playerId: p.body.id as string };
}

async function uploadDocument(
  p: { cookie: string; playerId: string },
  type = 'pan',
  contentType = 'application/pdf',
) {
  const t = await request(http)
    .post(`/players/${p.playerId}/documents`)
    .set('Cookie', p.cookie)
    .send({ type, contentType, size: 200_000 })
    .expect(201);
  storage.put(t.body.key, { size: 200_000, contentType });
  const doc = await request(http)
    .put(`/players/${p.playerId}/documents`)
    .set('Cookie', p.cookie)
    .send({ type, key: t.body.key })
    .expect(200);
  return { ...doc.body, key: t.body.key as string };
}

beforeAll(async () => {
  await resetDb(prisma);
  await seed(prisma);
  app = await bootApp();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('ID documents', () => {
  it('uploads JPEG/PNG/PDF only, one per type, and shows the player metadata but no file link', async () => {
    const p = await newPlayer('doc-1');
    await request(http)
      .post(`/players/${p.playerId}/documents`)
      .set('Cookie', p.cookie)
      .send({ type: 'aadhaar_full', contentType: 'application/pdf', size: 1000 })
      .expect(400);
    await request(http)
      .post(`/players/${p.playerId}/documents`)
      .set('Cookie', p.cookie)
      .send({ type: 'pan', contentType: 'image/gif', size: 1000 })
      .expect(400);

    const first = await uploadDocument(p);
    const second = await uploadDocument(p); // replaces the first
    expect(storage.objects.has(first.key)).toBe(false);
    await uploadDocument(p, 'masked_aadhaar', 'image/jpeg');

    const me = await request(http).get('/me/player').set('Cookie', p.cookie).expect(200);
    expect(me.body.documents.map((d: { type: string }) => d.type).sort()).toEqual([
      'masked_aadhaar',
      'pan',
    ]);
    expect(JSON.stringify(me.body.documents)).not.toContain('storage.test');

    await request(http)
      .delete(`/players/${p.playerId}/documents/${second.id}`)
      .set('Cookie', p.cookie)
      .expect(204);
    expect(storage.objects.has(second.key)).toBe(false);
  });
});

describe('private profile (organizers only, ID views logged)', () => {
  it('gives organizers of an entered tournament 5-minute ID links and logs every view', async () => {
    const owner = await signIn(app, { sub: 'priv-owner' });
    const { id: tId } = await createTournament(app, owner, 'cricket');
    const p = await newPlayer('priv-player');
    await request(http)
      .patch(`/players/${p.playerId}`)
      .set('Cookie', p.cookie)
      .send({ phone: '+91 98450 12345', emergencyContact: contact, medicalNotes: 'None' })
      .expect(200);
    const doc = await uploadDocument(p);

    // Before the player enters the tournament, even its owner can't see them.
    await request(http)
      .get(`/players/${p.playerId}/private`)
      .set('Cookie', owner.cookie)
      .expect(403);
    await request(http)
      .post(`/tournaments/${tId}/registrations`)
      .set('Cookie', p.cookie)
      .expect(201);

    const res = await request(http)
      .get(`/players/${p.playerId}/private`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(res.body).toMatchObject({
      phone: '+91 98450 12345',
      emergencyContact: contact,
      dob: '1996-08-20',
    });
    expect(res.body.documents[0].url).toContain(`ttl=300`);
    await request(http)
      .get(`/players/${p.playerId}/private`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const views = await prisma.auditLog.findMany({
      where: { action: 'document.viewed', entityId: doc.id },
    });
    expect(views).toHaveLength(2);
    expect(views[0]!.actorId).toBe(owner.userId);

    // Strangers, other organizers and the player themselves are refused.
    const stranger = await signIn(app, { sub: 'priv-stranger' });
    const otherOwner = await signIn(app, { sub: 'priv-other-owner' });
    await createTournament(app, otherOwner, 'football');
    await request(http)
      .get(`/players/${p.playerId}/private`)
      .set('Cookie', stranger.cookie)
      .expect(403);
    await request(http)
      .get(`/players/${p.playerId}/private`)
      .set('Cookie', otherOwner.cookie)
      .expect(403);
    await request(http).get(`/players/${p.playerId}/private`).set('Cookie', p.cookie).expect(403);
    await request(http).get(`/players/${p.playerId}/private`).expect(401);
  });
});

describe('public player page', () => {
  it('works signed out and shows only public fields, with role badges from the pack', async () => {
    const p = await newPlayer('public-1');
    await request(http)
      .patch(`/players/${p.playerId}`)
      .set('Cookie', p.cookie)
      .send({
        phone: '+91 90000 22222',
        emergencyContact: contact,
        medicalNotes: 'Diabetic',
        bio: 'Left-arm spinner from Mysuru.',
        socialLinks: ['https://instagram.com/arjun'],
      })
      .expect(200);
    await request(http)
      .post(`/players/${p.playerId}/sport-profiles/cricket`)
      .set('Cookie', p.cookie)
      .send({
        attributes: {
          experienceLevel: 'state',
          role: 'bowler',
          battingHand: 'left',
          bowlingStyle: 'left_arm_medium',
        },
      })
      .expect(201);
    await uploadDocument(p);

    const res = await request(http).get(`/players/${p.playerId}`).expect(200);
    expect(res.body).toMatchObject({
      displayName: 'Arjun Rao',
      city: 'Mysuru',
      ageGroup: expect.any(String),
      bio: 'Left-arm spinner from Mysuru.',
      socialLinks: ['https://instagram.com/arjun'],
      sports: [{ code: 'cricket', badges: ['Bowler', 'state'] }],
    });
    const text = JSON.stringify(res.body);
    for (const secret of ['1996-08-20', '90000 22222', 'Diabetic', 'Kavya', 'documents']) {
      expect(text).not.toContain(secret);
    }
    await request(http).get('/players/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('includes completeness in /me', async () => {
    const p = await newPlayer('complete-1');
    const me = await request(http).get('/me').set('Cookie', p.cookie).expect(200);
    expect(me.body.completeness).toEqual({
      percent: 20,
      missing: ['Photo', 'Emergency contact', 'At least one sport', 'ID document'],
    });
  });
});

describe('my data', () => {
  it('downloads everything as a JSON attachment', async () => {
    const p = await newPlayer('export-1');
    await uploadDocument(p);
    const res = await request(http).get('/me/data').set('Cookie', p.cookie).expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.account.email).toBe('export-1@example.com');
    expect(res.body.player).toMatchObject({ displayName: 'Arjun Rao', city: 'Mysuru' });
    expect(res.body.player.documents).toHaveLength(1);
    expect(res.body.account.consents[0]).toMatchObject({ scope: 'data_use' });
  });

  it('blocks deletion while you own a tournament', async () => {
    const owner = await signIn(app, { sub: 'deleting-owner' });
    await createTournament(app, owner, 'chess');
    await request(http).delete('/me/data').set('Cookie', owner.cookie).expect(409);
  });

  it('deletes the account: purges personal data and files, ends sessions, frees the Google account', async () => {
    const owner = await signIn(app, { sub: 'del-owner' });
    const { id: tId } = await createTournament(app, owner, 'kabaddi');
    const p = await newPlayer('leaver-2');
    const doc = await uploadDocument(p);
    await request(http)
      .post(`/tournaments/${tId}/registrations`)
      .set('Cookie', p.cookie)
      .expect(201);

    const res = await request(http).delete('/me/data').set('Cookie', p.cookie).expect(204);
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join()).toContain('fp_rt=;');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    expect(user).toMatchObject({ name: 'Deleted user', googleSub: `deleted:${p.userId}` });
    expect(user.deletedAt).not.toBeNull();
    const player = await prisma.player.findUniqueOrThrow({ where: { id: p.playerId } });
    expect(player).toMatchObject({
      displayName: 'Deleted player',
      dob: null,
      city: null,
      phone: null,
    });
    expect(storage.objects.has(doc.key)).toBe(false);
    expect(await prisma.consent.count({ where: { userId: p.userId } })).toBe(0);
    // Tournament history stays, anonymised.
    expect(await prisma.registration.count({ where: { playerId: p.playerId } })).toBe(1);

    await request(http).post('/auth/refresh').set('Cookie', p.cookie).expect(401);
    await request(http).get('/me').set('Cookie', p.cookie).expect(401);
    await request(http).get(`/players/${p.playerId}`).expect(404);

    // Signing in with the same Google account starts fresh.
    const again = await signIn(app, { sub: 'leaver-2' });
    expect(again.userId).not.toBe(p.userId);
  });
});
