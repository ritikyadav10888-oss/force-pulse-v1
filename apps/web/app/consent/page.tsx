'use client';
import { POLICY_VERSION, type ConsentScope, type MeResponse } from '@force-pulse/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';

export default function ConsentPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<MeResponse>('/me')
      .then((m) => (m.consent.required ? setMe(m) : router.replace('/me')))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace('/signin');
      });
  }, [router]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const scopes: ConsentScope[] = ['data_use'];
    if (form.get('photos')) scopes.push('photos_on_streams');
    try {
      await post('/me/consent', { policyVersion: POLICY_VERSION, scopes });
      router.replace('/me');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!me) return <p className="p-4">Loading…</p>;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold">Before you start</h1>
      <p className="text-neutral-700">
        Signed in as {me.user.email}. Please read our{' '}
        <Link href="/privacy" className="text-blue-700 underline">
          privacy policy
        </Link>{' '}
        (version {POLICY_VERSION}).
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex items-start gap-3 rounded border p-3">
          <input type="checkbox" name="data" required className="mt-1 size-5" />
          <span>
            <span className="font-medium">Use my data to run tournaments</span> (required). Your
            profile, registrations and sport details are stored and shown to organizers.
          </span>
        </label>
        <label className="flex items-start gap-3 rounded border p-3">
          <input type="checkbox" name="photos" className="mt-1 size-5" />
          <span>
            <span className="font-medium">Show my photo on live streams and overlays</span>{' '}
            (optional). You can change this later.
          </span>
        </label>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <button className="rounded bg-blue-600 px-4 py-3 text-white">Continue</button>
        <button
          type="button"
          className="text-sm underline"
          onClick={() => post('/auth/logout').then(() => router.replace('/'))}
        >
          Cancel and sign out
        </button>
      </form>
    </main>
  );
}
