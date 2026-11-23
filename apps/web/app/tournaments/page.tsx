'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';

interface Tournament {
  id: string;
  name: string;
  category: string;
  registrationOpen: boolean;
  event: { name: string; startDate: string };
  sport: { name: string };
}

export default function TournamentsPage() {
  const router = useRouter();
  const [list, setList] = useState<Tournament[] | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});

  useEffect(() => {
    void api<Tournament[]>('/tournaments').then(setList);
  }, []);

  async function register(id: string) {
    try {
      await post(`/tournaments/${id}/registrations`);
      setMessage((m) => ({ ...m, [id]: 'Registered. Waiting for organizer approval.' }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return router.push('/signin');
      setMessage((m) => ({ ...m, [id]: (e as Error).message }));
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tournaments</h1>
        <Link href="/me" className="text-blue-700 underline">
          My profile
        </Link>
      </div>
      {!list && <p>Loading…</p>}
      {list?.map((t) => (
        <article key={t.id} className="flex flex-col gap-2 rounded border p-3">
          <div>
            <p className="font-medium">{t.name}</p>
            <p className="text-sm text-neutral-600">
              {t.sport.name} · {t.category} · {t.event.name}, starts{' '}
              {t.event.startDate.slice(0, 10)}
            </p>
          </div>
          {t.registrationOpen ? (
            <button
              className="self-start rounded bg-blue-600 px-4 py-2 text-white"
              onClick={() => register(t.id)}
            >
              Register
            </button>
          ) : (
            <p className="text-sm text-neutral-600">Registration closed</p>
          )}
          {message[t.id] && (
            <p role="status" className="text-sm">
              {message[t.id]}
            </p>
          )}
        </article>
      ))}
    </main>
  );
}
