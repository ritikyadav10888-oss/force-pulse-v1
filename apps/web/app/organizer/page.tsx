'use client';
import type { RegistrationStatus } from '@force-pulse/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, patch } from '@/lib/api';
import { useMe } from '@/lib/use-me';

interface Tournament {
  id: string;
  name: string;
  sport: { name: string };
}
interface QueueItem {
  id: string;
  status: RegistrationStatus;
  player: { displayName: string; city: string | null; gender: string | null };
}

export default function OrganizerPage() {
  const { me } = useMe();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selected, setSelected] = useState('');
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    const isAdmin = me.roles.some((r) => r.role === 'super_admin');
    const mine = new Set(me.roles.filter((r) => r.role === 'organizer').map((r) => r.tournamentId));
    void api<Tournament[]>('/tournaments').then((all) => {
      const visible = all.filter((t) => isAdmin || mine.has(t.id));
      setTournaments(visible);
      setSelected((s) => s || visible[0]?.id || '');
    });
  }, [me]);

  const load = useCallback(() => {
    if (!selected) return;
    setQueue(null);
    void api<QueueItem[]>(`/tournaments/${selected}/registrations?status=pending`)
      .then(setQueue)
      .catch((e: Error) => setError(e.message));
  }, [selected]);
  useEffect(load, [load]);

  async function review(id: string, status: 'approved' | 'rejected') {
    setError('');
    try {
      await patch(`/registrations/${id}`, { status, reason: reasons[id] || undefined });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!me) return <p className="p-4">Loading…</p>;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Approval queue</h1>
        <Link href="/me" className="text-blue-700 underline">
          Back
        </Link>
      </div>
      {tournaments.length === 0 ? (
        <p>You are not an organizer of any tournament.</p>
      ) : (
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border p-2"
        >
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.sport.name})
            </option>
          ))}
        </select>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {queue?.length === 0 && <p className="text-neutral-600">No pending registrations.</p>}
      {queue?.map((r) => (
        <article key={r.id} className="flex flex-col gap-2 rounded border p-3">
          <p className="font-medium">{r.player.displayName}</p>
          <p className="text-sm text-neutral-600">
            {r.player.city} · {r.player.gender}
          </p>
          <input
            placeholder="Reason (required to reject)"
            value={reasons[r.id] ?? ''}
            onChange={(e) => setReasons((x) => ({ ...x, [r.id]: e.target.value }))}
            className="rounded border p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              className="flex-1 rounded bg-green-600 py-2 text-white"
              onClick={() => review(r.id, 'approved')}
            >
              Approve
            </button>
            <button
              className="flex-1 rounded bg-red-600 py-2 text-white"
              onClick={() => review(r.id, 'rejected')}
            >
              Reject
            </button>
          </div>
        </article>
      ))}
    </main>
  );
}
