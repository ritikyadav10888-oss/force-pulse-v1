'use client';
import { can, type MyTournament, type RegistrationStatus } from '@force-pulse/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { api, patch } from '@/lib/api';
import { useMe } from '@/lib/use-me';

interface QueueItem {
  id: string;
  status: RegistrationStatus;
  selfApproved: boolean;
  player: { displayName: string; city: string | null; gender: string | null };
}

function Organizer() {
  const { me } = useMe();
  const params = useSearchParams();
  const [tournaments, setTournaments] = useState<MyTournament[]>([]);
  const [selected, setSelected] = useState(params.get('t') ?? '');
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    void api<MyTournament[]>('/me/tournaments').then((all) => {
      const managed = all.filter((t) => can(t.roles, 'registrations.view'));
      setTournaments(managed);
      setSelected((s) => s || managed[0]?.id || '');
    });
  }, [me]);

  const current = tournaments.find((t) => t.id === selected);

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

  async function toggleRegistration(open: boolean) {
    setError('');
    try {
      await patch(`/tournaments/${selected}/registration`, { open });
      setTournaments((ts) =>
        ts.map((t) => (t.id === selected ? { ...t, registrationOpen: open } : t)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!me) return <p className="p-4">Loading…</p>;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage players</h1>
        <Link href="/me" className="text-blue-700 underline">
          Back
        </Link>
      </div>
      {tournaments.length === 0 ? (
        <p>
          You don&apos;t organize any tournament yet.{' '}
          <Link href="/organizer/new" className="text-blue-700 underline">
            Create one
          </Link>
          .
        </p>
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

      {current && !current.modules.registration && (
        <p className="rounded bg-neutral-100 p-3 text-sm">
          Player registration is off for this tournament. Adding players directly and join links are
          coming in the next milestone.
        </p>
      )}
      {current?.modules.registration && (
        <div className="flex items-center justify-between rounded border p-3">
          <span>Registration is {current.registrationOpen ? 'open' : 'closed'}</span>
          <button
            className="rounded bg-neutral-900 px-3 py-2 text-sm text-white"
            onClick={() => toggleRegistration(!current.registrationOpen)}
          >
            {current.registrationOpen ? 'Close' : 'Open'} registration
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {current?.modules.registration && queue?.length === 0 && (
        <p className="text-neutral-600">No pending registrations.</p>
      )}
      {current?.modules.registration &&
        queue?.map((r) => (
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
      {current && <ReviewedList tournamentId={current.id} key={`${current.id}-${queue?.length}`} />}
    </main>
  );
}

/** Recently approved, with the "self-approved" badge where the owner approved themselves. */
function ReviewedList({ tournamentId }: { tournamentId: string }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  useEffect(() => {
    void api<QueueItem[]>(`/tournaments/${tournamentId}/registrations?status=approved`).then(
      setItems,
    );
  }, [tournamentId]);
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Approved</h2>
      {items.map((r) => (
        <p key={r.id} className="flex items-center justify-between rounded border p-2 text-sm">
          {r.player.displayName}
          {r.selfApproved && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">self-approved</span>
          )}
        </p>
      ))}
    </section>
  );
}

export default function OrganizerPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<p className="p-4">Loading…</p>}>
      <Organizer />
    </Suspense>
  );
}
