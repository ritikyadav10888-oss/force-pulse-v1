'use client';
import { createPlayerSchema, GENDERS, type RegistrationStatus } from '@force-pulse/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
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
  const { me, reload } = useMe();
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (me?.player) void api<MyRegistration[]>('/me/registrations').then(setRegs);
  }, [me]);

  async function createProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = createPlayerSchema.safeParse({ ...form, phone: form.phone || undefined });
    if (!parsed.success)
      return setError(
        parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join(', '),
      );
    try {
      await post('/players', parsed.data);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
        <form onSubmit={createProfile} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Create your player profile</h2>
          <label className="flex flex-col gap-1">
            Name
            <input
              name="displayName"
              required
              defaultValue={me.user.name}
              className="rounded border p-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            Date of birth
            <input name="dob" type="date" required className="rounded border p-2" />
          </label>
          <label className="flex flex-col gap-1">
            Gender
            <select name="gender" required className="rounded border p-2">
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            City
            <input name="city" required className="rounded border p-2" />
          </label>
          <label className="flex flex-col gap-1">
            Phone (optional)
            <input name="phone" type="tel" className="rounded border p-2" />
          </label>
          {error && (
            <p role="alert" className="text-red-600">
              {error}
            </p>
          )}
          <button className="rounded bg-blue-600 px-4 py-3 text-white">Save profile</button>
        </form>
      ) : (
        <section className="flex flex-col gap-3">
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
