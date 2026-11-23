'use client';
import {
  createEventSchema,
  createTournamentSchema,
  MODULES,
  type Module,
} from '@force-pulse/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, post } from '@/lib/api';
import { useMe } from '@/lib/use-me';

interface Sport {
  code: string;
  name: string;
}

const moduleLabel: Record<Module, string> = {
  registration: 'Player registration',
  auction: 'Auction (coming soon)',
  scoring: 'Live scoring (coming soon)',
  fantasy: 'Fantasy (coming soon)',
};

const issuesText = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues.map((i) => `${String(i.path[0])}: ${i.message}`).join(', ');

/** Any signed-in user can create an event + tournament and becomes its owner. */
export default function NewTournament() {
  const router = useRouter();
  const { me } = useMe();
  const [sports, setSports] = useState<Sport[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Sport[]>('/sports').then(setSports);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const event = createEventSchema.safeParse({
      name: f.eventName,
      orgName: f.orgName,
      startDate: f.startDate,
      endDate: f.endDate,
    });
    const tournament = createTournamentSchema.safeParse({
      sportCode: f.sportCode,
      name: f.name,
      category: f.category,
      entryType: f.entryType,
      genderRule: f.genderRule,
      ageMin: f.ageMin ? Number(f.ageMin) : undefined,
      ageMax: f.ageMax ? Number(f.ageMax) : undefined,
      modules: Object.fromEntries(MODULES.map((m) => [m, f[`module_${m}`] === 'on'])),
    });
    if (!event.success) return setError(issuesText(event.error.issues));
    if (!tournament.success) return setError(issuesText(tournament.error.issues));

    setBusy(true);
    try {
      const ev = await post<{ id: string }>('/events', event.data);
      const t = await post<{ id: string }>(`/events/${ev.id}/tournaments`, tournament.data);
      router.push(`/organizer?t=${t.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!me) return <p className="p-4">Loading…</p>;

  const input = 'rounded border p-2';
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Create tournament</h1>
        <Link href="/me" className="text-blue-700 underline">
          Back
        </Link>
      </div>
      <p className="text-sm text-neutral-600">You&apos;ll be the owner. No approval needed.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-3 rounded border p-3">
          <legend className="px-1 font-semibold">Event</legend>
          <label className="flex flex-col gap-1">
            Event name
            <input
              name="eventName"
              required
              placeholder="City Sports Fest 2027"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            Organization
            <input name="orgName" required className={input} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              Starts
              <input name="startDate" type="date" required className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Ends
              <input name="endDate" type="date" required className={input} />
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded border p-3">
          <legend className="px-1 font-semibold">Tournament</legend>
          <label className="flex flex-col gap-1">
            Sport
            <select name="sportCode" required className={input}>
              {sports.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Tournament name
            <input name="name" required className={input} />
          </label>
          <label className="flex flex-col gap-1">
            Category
            <input
              name="category"
              required
              placeholder="Men's open, U-19, Women's doubles…"
              className={input}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              Entry
              <select name="entryType" className={input}>
                <option value="individual">Individual</option>
                <option value="team">Team</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Gender
              <select name="genderRule" className={input}>
                <option value="open">Open</option>
                <option value="men">Men</option>
                <option value="women">Women</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Min age
              <input name="ageMin" type="number" min={5} max={100} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              Max age
              <input name="ageMax" type="number" min={5} max={100} className={input} />
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded border p-3">
          <legend className="px-1 font-semibold">Modules this tournament uses</legend>
          {MODULES.map((m) => (
            <label key={m} className="flex items-center gap-3">
              <input
                type="checkbox"
                name={`module_${m}`}
                defaultChecked={m === 'registration'}
                className="size-5"
              />
              {moduleLabel[m]}
            </label>
          ))}
          <p className="text-sm text-neutral-600">
            Without player registration you add players yourself or share a join link.
          </p>
        </fieldset>

        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-3 text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create tournament'}
        </button>
      </form>
    </main>
  );
}
