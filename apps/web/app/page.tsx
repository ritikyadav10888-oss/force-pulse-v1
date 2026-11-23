import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-bold">Force Pulse</h1>
      <p className="text-neutral-600">Register for tournaments across six sports.</p>
      <Link href="/tournaments" className="rounded bg-blue-600 px-4 py-3 text-center text-white">
        Browse tournaments
      </Link>
      <Link href="/me" className="rounded border px-4 py-3 text-center">
        My profile
      </Link>
    </main>
  );
}
