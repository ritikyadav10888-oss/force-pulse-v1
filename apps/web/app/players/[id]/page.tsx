import type { PublicPlayer } from '@force-pulse/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShareButton } from './share-button';

// Server-rendered from the API directly (not via /api): fast first paint, works signed out.
async function load(id: string): Promise<PublicPlayer | null> {
  const res = await fetch(
    `${process.env.API_URL ?? 'http://localhost:4000'}/players/${encodeURIComponent(id)}`,
    {
      // Photo links are signed for an hour; refreshing every minute keeps them valid.
      next: { revalidate: 60 },
    },
  );
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Player page failed: ${res.status}`);
  return res.json() as Promise<PublicPlayer>;
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).id);
  return p
    ? {
        title: `${p.displayName} · Force Pulse`,
        description: p.sports.map((s) => s.name).join(', '),
      }
    : { title: 'Player not found · Force Pulse' };
}

export default async function PlayerPage({ params }: Props) {
  const p = await load((await params).id);
  if (!p) notFound();
  const place = [p.city, p.state].filter(Boolean).join(', ');

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-center gap-4">
        <div className="size-24 shrink-0 overflow-hidden rounded-full bg-muted">
          {p.photoUrl && (
            // Plain img: a signed storage URL, nothing for the Next image optimizer to do.
            <img src={p.photoUrl} alt={p.displayName} className="size-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold">{p.displayName}</h1>
          <p className="text-sm text-muted-foreground">
            {[place, p.ageGroup && `Age ${p.ageGroup}`].filter(Boolean).join(' · ')}
          </p>
          <ShareButton title={p.displayName} />
        </div>
      </header>

      {p.bio && <p>{p.bio}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Sports</h2>
        {p.sports.length === 0 && (
          <p className="text-sm text-muted-foreground">No sports added yet.</p>
        )}
        {p.sports.map((s) => (
          <div key={s.code} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
            <span className="font-medium">{s.name}</span>
            {s.badges.map((b) => (
              <span key={b} className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                {b}
              </span>
            ))}
          </div>
        ))}
      </section>

      {p.socialLinks.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Links</h2>
          {p.socialLinks.map((l) => (
            <a
              key={l}
              href={l}
              rel="nofollow noopener noreferrer"
              target="_blank"
              className="truncate text-blue-700 underline"
            >
              {l.replace(/^https?:\/\//, '')}
            </a>
          ))}
        </section>
      )}

      {['Stats', 'Teams', 'Auction history'].map((title) => (
        <section key={title} className="flex flex-col gap-1 rounded-md border border-dashed p-3">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">Coming soon</p>
        </section>
      ))}
    </main>
  );
}
