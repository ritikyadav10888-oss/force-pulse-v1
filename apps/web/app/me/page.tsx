'use client';
import type { RegistrationStatus } from '@force-pulse/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, post } from '@/lib/api';
import { MyTournaments } from '@/components/my-tournaments';
import { useMe } from '@/lib/use-me';

interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  reason: string | null;
  tournament: { id: string; name: string; category: string; sport: { name: string } };
}

const badge: Record<RegistrationStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  approved: 'bg-green-100 text-green-900',
  rejected: 'bg-red-100 text-red-900',
};

export default function MePage() {
  const router = useRouter();
  const { me } = useMe();
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (me?.player) void api<MyRegistration[]>('/me/registrations').then(setRegs);
  }, [me]);

  async function resubmit(tournamentId: string) {
    await post(`/tournaments/${tournamentId}/registrations`).catch((e: Error) =>
      setError(e.message),
    );
    setRegs(await api<MyRegistration[]>('/me/registrations'));
  }

  if (!me) return <p className="p-4">Loading…</p>;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Hi, {me.player?.displayName ?? me.user.name}</h1>
        <button
          className="text-sm underline"
          onClick={() => post('/auth/logout').then(() => router.replace('/'))}
        >
          Sign out
        </button>
      </header>

      <MyTournaments />

      {!me.player ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Set up your player profile</h2>
          <p className="text-sm text-muted-foreground">
            Four short steps: about you, contact &amp; safety, your sports, review. You can stop and
            continue later.
          </p>
          <Link
            href="/profile/setup"
            className="rounded bg-blue-600 px-4 py-3 text-center text-white"
          >
            Start
          </Link>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <Link href="/profile/setup" className="rounded border px-4 py-3 text-center">
            Edit profile &amp; sports
          </Link>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">My registrations</h2>
            <Link href="/tournaments" className="text-blue-700 underline">
              Find tournaments
            </Link>
          </div>
          {error && (
            <p role="alert" className="text-red-600">
              {error}
            </p>
          )}
          {regs.length === 0 && <p className="text-neutral-600">No registrations yet.</p>}
          {regs.map((r) => (
            <article key={r.id} className="rounded border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{r.tournament.name}</p>
                  <p className="text-sm text-neutral-600">
                    {r.tournament.sport.name} · {r.tournament.category}
                  </p>
                </div>
                <span className={`rounded px-2 py-1 text-sm ${badge[r.status]}`}>{r.status}</span>
              </div>
              {r.status === 'rejected' && (
                <div className="mt-2 flex flex-col gap-2">
                  <p className="text-sm">Reason: {r.reason}</p>
                  <button
                    className="self-start text-sm text-blue-700 underline"
                    onClick={() => resubmit(r.tournament.id)}
                  >
                    Fixed it, resubmit
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
