'use client';
import { can, type MyTournament, type Role } from '@force-pulse/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const roleLabel: Record<Role, string> = {
  owner: 'Owner',
  co_organizer: 'Co-organizer',
  team_owner: 'Team owner',
  player: 'Player',
};

/** "My tournaments": every tournament the user is in, with their role(s), e.g. "Owner · Player". */
export function MyTournaments() {
  const [list, setList] = useState<MyTournament[] | null>(null);
  useEffect(() => {
    void api<MyTournament[]>('/me/tournaments').then(setList);
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My tournaments</h2>
        <Link href="/organizer/new" className="text-blue-700 underline">
          Create tournament
        </Link>
      </div>
      {list?.length === 0 && (
        <p className="text-neutral-600">You aren&apos;t in any tournament yet.</p>
      )}
      {list?.map((t) => (
        <article key={t.id} className="flex items-center justify-between gap-2 rounded border p-3">
          <div>
            <p className="font-medium">{t.name}</p>
            <p className="text-sm text-neutral-600">
              {t.sport.name} · {t.roles.map((r) => roleLabel[r]).join(' · ')}
            </p>
          </div>
          {can(t.roles, 'registrations.view') && (
            <Link
              href={`/organizer?t=${t.id}`}
              className="rounded bg-neutral-900 px-3 py-2 text-sm text-white"
            >
              Manage
            </Link>
          )}
        </article>
      ))}
    </section>
  );
}
