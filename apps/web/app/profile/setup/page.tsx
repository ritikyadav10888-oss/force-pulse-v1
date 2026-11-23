'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  contactPersonSchema,
  createPlayerSchema,
  GENDERS,
  isMinor,
  type CreatePlayer,
  type MyPlayerProfile,
  type UploadTicket,
} from '@force-pulse/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PhotoPicker } from '@/components/photo-picker';
import { SportForm } from '@/components/sport-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { api, del, patch, post, put, uploadToSignedUrl } from '@/lib/api';
import { useMe } from '@/lib/use-me';

const STEPS = ['About you', 'Contact & safety', 'Your sports', 'Review'] as const;
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm';

function Wizard() {
  const { me } = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const step = Math.min(Math.max(Number(params.get('step') ?? 1), 1), 4);
  const [profile, setProfile] = useState<MyPlayerProfile | null | undefined>(undefined);

  const reload = useCallback(() => api<MyPlayerProfile | null>('/me/player').then(setProfile), []);
  useEffect(() => {
    if (me) void reload();
  }, [me, reload]);

  const go = (n: number) => router.push(`/profile/setup?step=${n}`);

  if (!me || profile === undefined) return <p className="p-4">Loading…</p>;
  // Later steps need the core profile; send people back to step 1 until it exists.
  if (!profile && step > 1) {
    go(1);
    return null;
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Step {step} of 4 · {STEPS[step - 1]}
          </span>
          <Link href="/me" className="underline">
            Save &amp; finish later
          </Link>
        </div>
        <Progress value={(step / 4) * 100} aria-label="Profile progress" />
      </header>

      {step === 1 && (
        <AboutYou
          profile={profile}
          defaultName={me.user.name}
          onDone={() => reload().then(() => go(2))}
        />
      )}
      {step === 2 && profile && (
        <ContactSafety
          profile={profile}
          onBack={() => go(1)}
          onDone={() => reload().then(() => go(3))}
        />
      )}
      {step === 3 && profile && (
        <YourSports profile={profile} reload={reload} onBack={() => go(2)} onDone={() => go(4)} />
      )}
      {step === 4 && profile && <Review profile={profile} onBack={() => go(3)} />}
    </main>
  );
}

// ---- Step 1 ----------------------------------------------------------------------------------

function AboutYou({
  profile,
  defaultName,
  onDone,
}: {
  profile: MyPlayerProfile | null;
  defaultName: string;
  onDone: () => void;
}) {
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreatePlayer>({
    resolver: zodResolver(createPlayerSchema),
    defaultValues: {
      displayName: profile?.displayName ?? defaultName,
      dob: profile?.dob ?? undefined,
      gender: profile?.gender ?? undefined,
      city: profile?.city ?? undefined,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setError('');
    try {
      const id = profile
        ? (await patch<{ id: string }>(`/players/${profile.id}`, data)).id
        : (await post<{ id: string }>('/players', data)).id;
      if (photo) {
        const ticket = await post<UploadTicket>(`/players/${id}/photo`, {
          contentType: 'image/jpeg',
          size: photo.blob.size,
        });
        await uploadToSignedUrl(ticket, photo.blob);
        await put(`/players/${id}/photo`, { key: ticket.key });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-bold">About you</h1>
      <PhotoPicker
        previewUrl={photo?.preview ?? profile?.photoUrl ?? null}
        onCropped={(blob, preview) => setPhoto({ blob, preview })}
      />
      <Field label="Name" error={errors.displayName?.message}>
        <Input id="displayName" autoComplete="name" {...register('displayName')} />
      </Field>
      <Field label="Date of birth" error={errors.dob?.message}>
        <Input id="dob" type="date" {...register('dob')} />
      </Field>
      <Field label="Gender" error={errors.gender?.message}>
        <select
          id="gender"
          className={selectClass}
          {...register('gender', { setValueAs: emptyToUndefined })}
        >
          <option value="">Choose…</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {g[0]!.toUpperCase() + g.slice(1)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="City" error={errors.city?.message}>
        <Input id="city" autoComplete="address-level2" {...register('city')} />
      </Field>
      <FormError message={error} />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Save and continue'}
      </Button>
    </form>
  );
}

// ---- Step 2 ----------------------------------------------------------------------------------

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

function ContactSafety({
  profile,
  onBack,
  onDone,
}: {
  profile: MyPlayerProfile;
  onBack: () => void;
  onDone: () => void;
}) {
  const minor = isMinor(profile.dob);
  const schema = z.object({
    phone: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .regex(/^\+?[0-9 ()-]{7,20}$/, 'Phone number')
        .optional(),
    ),
    emergencyContact: contactPersonSchema,
    medicalNotes: optionalText(1000),
    guardian: minor ? contactPersonSchema : z.any().optional(),
  });
  type Form = z.infer<typeof schema>;
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      phone: profile.phone ?? '',
      emergencyContact: profile.emergencyContact ?? undefined,
      medicalNotes: profile.medicalNotes ?? '',
      guardian: profile.guardian ?? undefined,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setError('');
    try {
      await patch(`/players/${profile.id}`, {
        ...data,
        guardian: minor ? data.guardian : undefined,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  const person = (prefix: 'emergencyContact' | 'guardian') => {
    const e = errors[prefix] as Record<string, { message?: string }> | undefined;
    return (
      <div className="grid gap-3">
        <Field label="Name" error={e?.name?.message}>
          <Input id={`${prefix}.name`} {...register(`${prefix}.name` as const)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" error={e?.phone?.message}>
            <Input id={`${prefix}.phone`} type="tel" {...register(`${prefix}.phone` as const)} />
          </Field>
          <Field label="Relation" error={e?.relation?.message}>
            <Input
              id={`${prefix}.relation`}
              placeholder="Mother, coach…"
              {...register(`${prefix}.relation` as const)}
            />
          </Field>
        </div>
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-bold">Contact &amp; safety</h1>
      <p className="text-sm text-muted-foreground">
        Only organizers of tournaments you enter can see these.
      </p>
      <Field label="Your phone (optional)" error={errors.phone?.message as string | undefined}>
        <Input id="phone" type="tel" autoComplete="tel" {...register('phone')} />
      </Field>
      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-semibold">Emergency contact</legend>
        {person('emergencyContact')}
      </fieldset>
      {minor && (
        <fieldset className="flex flex-col gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">
            Parent or guardian (required under 18)
          </legend>
          {person('guardian')}
        </fieldset>
      )}
      <Field
        label="Medical notes (optional)"
        error={errors.medicalNotes?.message as string | undefined}
      >
        <Textarea
          id="medicalNotes"
          rows={3}
          placeholder="Allergies, conditions, medication"
          {...register('medicalNotes')}
        />
      </Field>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" className="flex-1" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save and continue'}
        </Button>
      </div>
    </form>
  );
}

// ---- Step 3 ----------------------------------------------------------------------------------

interface Sport {
  code: string;
  name: string;
}

function YourSports({
  profile,
  reload,
  onBack,
  onDone,
}: {
  profile: MyPlayerProfile;
  reload: () => Promise<void>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Sport[]>('/sports').then(setSports);
  }, []);
  const mine = new Map(profile.sportProfiles.map((s) => [s.sport.code, s]));

  async function remove(code: string) {
    setError('');
    try {
      await del(`/players/${profile.id}/sport-profiles/${code}`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Your sports</h1>
      <p className="text-sm text-muted-foreground">
        Tap a sport to add your details. Add as many as you play.
      </p>
      <div className="flex flex-col gap-3">
        {sports.map((s) => {
          const sp = mine.get(s.code);
          const isOpen = open === s.code;
          return (
            <article key={s.code} className="rounded-lg border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-3 text-left"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : s.code)}
              >
                <span className="font-medium">{s.name}</span>
                {sp ? (
                  <Badge variant={sp.status === 'pending_review' ? 'secondary' : 'default'}>
                    {sp.status === 'pending_review' ? 'Awaiting review' : 'Added'}
                  </Badge>
                ) : (
                  <span className="text-sm text-primary">Add</span>
                )}
              </button>
              {isOpen && (
                <div className="flex flex-col gap-3 border-t p-3">
                  {sp && (
                    <p className="text-xs text-muted-foreground">
                      Editing after an organizer approved you sends it back to them for review.
                    </p>
                  )}
                  <SportForm
                    playerId={profile.id}
                    sportCode={s.code}
                    existing={sp?.attributes}
                    onSaved={() => reload().then(() => setOpen(null))}
                  />
                  {sp && (
                    <Button type="button" variant="ghost" onClick={() => remove(s.code)}>
                      Remove {s.name}
                    </Button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" className="flex-1" onClick={onDone} disabled={mine.size === 0}>
          {mine.size === 0 ? 'Add at least one sport' : 'Continue'}
        </Button>
      </div>
    </section>
  );
}

// ---- Step 4 ----------------------------------------------------------------------------------

function Review({ profile, onBack }: { profile: MyPlayerProfile; onBack: () => void }) {
  const items: [string, boolean][] = [
    ['About you', !!(profile.dob && profile.gender && profile.city)],
    ['Photo', !!profile.photoUrl],
    ['Emergency contact', !!profile.emergencyContact],
    ['Guardian (under 18)', !isMinor(profile.dob) || !!profile.guardian],
    ['At least one sport', profile.sportProfiles.length > 0],
  ];
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Review</h1>
      <ul className="flex flex-col gap-2">
        {items.map(([label, ok]) => (
          <li key={label} className="flex items-center justify-between rounded-md border p-3">
            {label}
            <span className={ok ? 'text-green-700' : 'text-amber-700'}>
              {ok ? 'Done' : 'Missing'}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between rounded-md border border-dashed p-3 text-muted-foreground">
          ID document
          <span>Coming next</span>
        </li>
      </ul>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Link href="/me" className="flex-1">
          <Button type="button" className="w-full">
            Finish
          </Button>
        </Link>
      </div>
    </section>
  );
}

// ---- bits ------------------------------------------------------------------------------------

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={children.props.id}>{label}</Label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

export default function ProfileSetupPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<p className="p-4">Loading…</p>}>
      <Wizard />
    </Suspense>
  );
}
