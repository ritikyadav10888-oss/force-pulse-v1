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

const adult = { displayName: 'Meera Iyer', dob: '1999-03-10', gender: 'female', city: 'Chennai' };
const contact = { name: 'Lakshmi Iyer', phone: '+91 98400 00000', relation: 'Mother' };

async function newPlayer(sub: string, body: object = adult) {
  const s = await signIn(app, { sub });
  const p = await request(http).post('/players').set('Cookie', s.cookie).send(body).expect(201);
  return { ...s, playerId: p.body.id as string };
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

describe('wizard steps 1–2: core profile and contact & safety', () => {
  it('saves each step and returns the full profile', async () => {
    const p = await newPlayer('wiz-1');
    await request(http)
      .patch(`/players/${p.playerId}`)
      .set('Cookie', p.cookie)
      .send({
        phone: '+91 90000 11111',
        emergencyContact: contact,
        medicalNotes: 'Asthma inhaler in bag',
        state: 'Tamil Nadu',
      })
      .expect(200);
    const me = await request(http).get('/me/player').set('Cookie', p.cookie).expect(200);
    expect(me.body).toMatchObject({
      displayName: 'Meera Iyer',
      dob: '1999-03-10',
      state: 'Tamil Nadu',
      emergencyContact: contact,
      medicalNotes: 'Asthma inhaler in bag',
      guardian: null,
      photoUrl: null,
      sportProfiles: [],
    });
  });

  it('requires a guardian for under-18s when saving contact details and before registering', async () => {
    const owner = await signIn(app, { sub: 'minor-owner' });
    const t = await createTournament(app, owner, 'chess');
    const kid = await newPlayer('wiz-minor', { ...adult, dob: '2012-05-05' });
    await request(http)
      .patch(`/players/${kid.playerId}`)
      .set('Cookie', kid.cookie)
      .send({ emergencyContact: contact })
      .expect(400);
    await request(http)
      .post(`/tournaments/${t.id}/registrations`)
      .set('Cookie', kid.cookie)
      .expect(400);
    await request(http)
      .patch(`/players/${kid.playerId}`)
      .set('Cookie', kid.cookie)
      .send({ emergencyContact: contact, guardian: contact })
      .expect(200);
    await request(http)
      .post(`/tournaments/${t.id}/registrations`)
      .set('Cookie', kid.cookie)
      .expect(201);
  });
});

describe('sport profiles from rule packs', () => {
  it('validates per sport: fields change with the pack, and the pack version is stored', async () => {
    const p = await newPlayer('sporty');
    const base = `/players/${p.playerId}/sport-profiles`;

    const bad = await request(http)
      .post(`${base}/cricket`)
      .set('Cookie', p.cookie)
      .send({ attributes: { role: 'goalkeeper' } })
      .expect(400);
    expect(bad.body.issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(['role', 'battingHand', 'bowlingStyle', 'experienceLevel']),
    );

    const cricket = await request(http)
      .post(`${base}/cricket`)
      .set('Cookie', p.cookie)
      .send({
        attributes: {
          experienceLevel: 'district',
          yearsPlayed: 8,
          role: 'all_rounder',
          battingHand: 'left',
          bowlingStyle: 'off_spin',
          pastTeams: ['Chennai Colts'],
        },
      })
      .expect(201);
    expect(cricket.body).toMatchObject({ rulePackVersion: '1.0.0', status: 'active' });

    // Football's fields are different; cricket keys are rejected there.
    await request(http)
      .post(`${base}/football`)
      .set('Cookie', p.cookie)
      .send({ attributes: { experienceLevel: 'club', role: 'all_rounder', primaryPosition: 'CB' } })
      .expect(400);
    await request(http)
      .post(`${base}/football`)
      .set('Cookie', p.cookie)
      .send({
        attributes: { experienceLevel: 'club', primaryPosition: 'CB', preferredJerseyNumber: 4 },
      })
      .expect(201);

    // showIf: kabaddi defender position is dropped for raiders.
    const kabaddi = await request(http)
      .post(`${base}/kabaddi`)
      .set('Cookie', p.cookie)
      .send({
        attributes: { experienceLevel: 'state', role: 'raider', defenderPosition: 'left_corner' },
      })
      .expect(201);
    expect(kabaddi.body.attributesJson).toEqual({ experienceLevel: 'state', role: 'raider' });

    await request(http)
      .post(`${base}/cricket`)
      .set('Cookie', p.cookie)
      .send({ attributes: {} })
      .expect(409);
    await request(http)
      .post(`${base}/curling`)
      .set('Cookie', p.cookie)
      .send({ attributes: {} })
      .expect(404);

    const me = await request(http).get('/me/player').set('Cookie', p.cookie).expect(200);
    expect(
      me.body.sportProfiles.map((s: { sport: { code: string } }) => s.sport.code).sort(),
    ).toEqual(['cricket', 'football', 'kabaddi']);

    await request(http).delete(`${base}/kabaddi`).set('Cookie', p.cookie).expect(204);
    await request(http).delete(`${base}/kabaddi`).set('Cookie', p.cookie).expect(404);
  });

  it("stops others editing a player's sport profiles", async () => {
    const p = await newPlayer('sp-owner');
    const other = await newPlayer('sp-other');
    await request(http)
      .post(`/players/${p.playerId}/sport-profiles/chess`)
      .set('Cookie', other.cookie)
      .send({ attributes: { experienceLevel: 'club', ratingBody: 'unrated' } })
      .expect(403);
  });

  it('editing after approval sends the registration back for organizer review', async () => {
    const owner = await signIn(app, { sub: 'review-owner' });
    const t = await createTournament(app, owner, 'basketball');
    const p = await newPlayer('edit-after');
    const url = `/players/${p.playerId}/sport-profiles/basketball`;
    await request(http)
      .post(url)
      .set('Cookie', p.cookie)
      .send({ attributes: { experienceLevel: 'club', position: 'PG' } })
      .expect(201);
    const reg = await request(http)
      .post(`/tournaments/${t.id}/registrations`)
      .set('Cookie', p.cookie)
      .expect(201);
    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'approved' })
      .expect(200);

    const edited = await request(http)
      .patch(url)
      .set('Cookie', p.cookie)
      .send({ attributes: { experienceLevel: 'state', position: 'SG', heightCm: 188 } })
      .expect(200);
    expect(edited.body.status).toBe('pending_review');
    const regNow = await prisma.registration.findUniqueOrThrow({ where: { id: reg.body.id } });
    expect(regNow).toMatchObject({
      status: 'pending',
      reason: 'Sport profile edited after approval',
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'sport_profile.edited_after_approval', entityId: edited.body.id },
      }),
    ).toBe(1);
    const theirs = await request(http).get('/me/tournaments').set('Cookie', p.cookie).expect(200);
    expect(theirs.body).toEqual([]); // player membership removed until re-approved

    await request(http)
      .patch(`/registrations/${reg.body.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'approved' })
      .expect(200);
    const sp = await prisma.playerSportProfile.findUniqueOrThrow({ where: { id: edited.body.id } });
    expect(sp.status).toBe('active');
  });
});

describe('photo upload', () => {
  it('issues a signed upload, verifies the object, and replaces the old photo', async () => {
    const p = await newPlayer('photo-1');
    const url = `/players/${p.playerId}/photo`;
    await request(http)
      .post(url)
      .set('Cookie', p.cookie)
      .send({ contentType: 'image/gif', size: 1000 })
      .expect(400);
    await request(http)
      .post(url)
      .set('Cookie', p.cookie)
      .send({ contentType: 'image/jpeg', size: 6 * 1024 * 1024 })
      .expect(400);

    const t1 = await request(http)
      .post(url)
      .set('Cookie', p.cookie)
      .send({ contentType: 'image/jpeg', size: 90_000 })
      .expect(201);
    expect(t1.body.key).toMatch(new RegExp(`^players/${p.playerId}/photo/.+\\.jpg$`));
    expect(t1.body.headers['x-goog-content-length-range']).toBe(`0,${5 * 1024 * 1024}`);

    await request(http).put(url).set('Cookie', p.cookie).send({ key: t1.body.key }).expect(400); // not uploaded yet
    storage.put(t1.body.key, { size: 90_000, contentType: 'image/jpeg' });
    const ok = await request(http)
      .put(url)
      .set('Cookie', p.cookie)
      .send({ key: t1.body.key })
      .expect(200);
    expect(ok.body.photoUrl).toContain(t1.body.key);

    // A second photo replaces the first, which is deleted from storage.
    const t2 = await request(http)
      .post(url)
      .set('Cookie', p.cookie)
      .send({ contentType: 'image/png', size: 50_000 })
      .expect(201);
    storage.put(t2.body.key, { size: 50_000, contentType: 'image/png' });
    await request(http).put(url).set('Cookie', p.cookie).send({ key: t2.body.key }).expect(200);
    expect(storage.objects.has(t1.body.key)).toBe(false);
    const me = await request(http).get('/me/player').set('Cookie', p.cookie).expect(200);
    expect(me.body.photoUrl).toContain(t2.body.key);
  });

  it("rejects another player's key, wrong file types that slipped through, and strangers", async () => {
    const a = await newPlayer('photo-a');
    const b = await newPlayer('photo-b');
    const tb = await request(http)
      .post(`/players/${b.playerId}/photo`)
      .set('Cookie', b.cookie)
      .send({ contentType: 'image/jpeg', size: 1000 })
      .expect(201);
    storage.put(tb.body.key, { size: 1000, contentType: 'image/jpeg' });
    await request(http)
      .put(`/players/${a.playerId}/photo`)
      .set('Cookie', a.cookie)
      .send({ key: tb.body.key })
      .expect(400);
    await request(http)
      .post(`/players/${b.playerId}/photo`)
      .set('Cookie', a.cookie)
      .send({ contentType: 'image/jpeg', size: 1000 })
      .expect(403);

    const ta = await request(http)
      .post(`/players/${a.playerId}/photo`)
      .set('Cookie', a.cookie)
      .send({ contentType: 'image/jpeg', size: 1000 })
      .expect(201);
    storage.put(ta.body.key, { size: 1000, contentType: 'text/html' });
    await request(http)
      .put(`/players/${a.playerId}/photo`)
      .set('Cookie', a.cookie)
      .send({ key: ta.body.key })
      .expect(400);
    expect(storage.objects.has(ta.body.key)).toBe(false);
  });
});
