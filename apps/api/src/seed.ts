// Idempotent seed: sports + published rule packs. Tournaments are created by their owners;
// the demo event, owners and sample players arrive with the Milestone 7 demo seed.
// Runs after migrations on every deploy (Cloud Run Job) and via `pnpm db:seed` locally.
import './instrument';
import { isDeepStrictEqual } from 'node:util';
import { PrismaClient, type Prisma } from '@prisma/client';
import { latestPacks, loadPacks } from '@force-pulse/rule-packs';

export async function seed(prisma: PrismaClient) {
  const packs = loadPacks();
  const sportIds = new Map<string, string>();

  for (const pack of latestPacks(packs)) {
    const data = { name: pack.name, scoringModel: pack.scoringModel, isTeamSport: pack.teamSport };
    const sport = await prisma.sport.upsert({
      where: { code: pack.id },
      create: { code: pack.id, ...data },
      update: data,
    });
    sportIds.set(pack.id, sport.id);
  }

  for (const pack of packs) {
    const sportId = sportIds.get(pack.id)!;
    const existing = await prisma.rulePack.findUnique({
      where: { sportId_version: { sportId, version: pack.version } },
    });
    if (!existing) {
      await prisma.rulePack.create({
        data: {
          sportId,
          version: pack.version,
          contentJson: pack as unknown as Prisma.InputJsonValue,
        },
      });
    } else if (!isDeepStrictEqual(existing.contentJson, JSON.parse(JSON.stringify(pack)))) {
      throw new Error(
        `Rule pack ${pack.id}@${pack.version} differs from the published copy; publish a new version.`,
      );
    }
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log(JSON.stringify({ level: 30, msg: 'seed complete' })))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
