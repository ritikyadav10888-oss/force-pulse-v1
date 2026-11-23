import type { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'auditLog'>;

/** Append-only audit trail. Pass the transaction client so the log commits with the change. */
export function audit(
  db: Db,
  entry: {
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
) {
  return db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      beforeJson: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      afterJson: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
