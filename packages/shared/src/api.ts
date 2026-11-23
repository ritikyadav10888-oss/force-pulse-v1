import { z } from 'zod';

/** Per-tournament roles. Super admin is a user flag, not a role, and has no tournament powers. */
export const ROLES = ['owner', 'co_organizer', 'team_owner', 'player'] as const;
export type Role = (typeof ROLES)[number];

export const GENDERS = ['male', 'female', 'other'] as const;
export const REGISTRATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const googleSignInSchema = z.object({ credential: z.string().min(20).max(4096) });

const isoDate = z.iso.date();

export const createPlayerSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  dob: isoDate.refine((d) => {
    const age = (Date.now() - Date.parse(d)) / (365.25 * 24 * 3600 * 1000);
    return age >= 5 && age <= 100;
  }, 'Age must be between 5 and 100'),
  gender: z.enum(GENDERS),
  city: z.string().trim().min(2).max(80),
  // Typed, not verified (no OTP in Gate 1).
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Phone number')
    .optional(),
});
export type CreatePlayer = z.infer<typeof createPlayerSchema>;

export const updatePlayerSchema = createPlayerSchema.partial();

export const reviewRegistrationSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((r) => r.status !== 'rejected' || r.reason, {
    message: 'A reason is required when rejecting',
    path: ['reason'],
  });

export const listRegistrationsQuerySchema = z.object({
  status: z.enum(REGISTRATION_STATUSES).optional(),
});

/** Bump when the privacy policy changes meaningfully; everyone is asked to consent again. */
export const POLICY_VERSION = '2026-11-23';
/** data_use is required to use the app; photos_on_streams is optional. */
export const CONSENT_SCOPES = ['data_use', 'photos_on_streams'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const consentSchema = z.object({
  policyVersion: z.literal(POLICY_VERSION, { error: 'Please review the latest privacy policy' }),
  scopes: z
    .array(z.enum(CONSENT_SCOPES))
    .refine((s) => s.includes('data_use'), 'Consent to data use is required'),
});

export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    isSuperAdmin: boolean;
  };
  roles: { role: Role; tournamentId: string }[];
  player: { id: string; displayName: string } | null;
  /** required = true until the user consents to data use under the current policy version. */
  consent: { policyVersion: string; scopes: ConsentScope[]; required: boolean };
}

export const MODULES = ['registration', 'auction', 'scoring', 'fantasy'] as const;
export type Module = (typeof MODULES)[number];
export const modulesSchema = z.object({
  registration: z.boolean(),
  auction: z.boolean(),
  scoring: z.boolean(),
  fantasy: z.boolean(),
});
export type Modules = z.infer<typeof modulesSchema>;

export const createEventSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    orgName: z.string().trim().min(2).max(100),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((e) => e.endDate >= e.startDate, {
    message: 'End date is before start date',
    path: ['endDate'],
  });
export type CreateEvent = z.infer<typeof createEventSchema>;

export const createTournamentSchema = z
  .object({
    sportCode: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string().trim().min(3).max(100),
    category: z.string().trim().min(2).max(60),
    entryType: z.enum(['team', 'individual']),
    genderRule: z.enum(['open', 'men', 'women', 'mixed']).default('open'),
    ageMin: z.number().int().min(5).max(100).optional(),
    ageMax: z.number().int().min(5).max(100).optional(),
    registrationDeadline: z.iso.datetime({ offset: true }).optional(),
    modules: modulesSchema,
  })
  .refine((t) => t.ageMin === undefined || t.ageMax === undefined || t.ageMin <= t.ageMax, {
    message: 'Minimum age is above maximum age',
    path: ['ageMax'],
  });
export type CreateTournament = z.infer<typeof createTournamentSchema>;

export const toggleRegistrationSchema = z.object({ open: z.boolean() });

/**
 * Who may do what inside a tournament. "Organizer" = owner or co-organizer.
 * Co-organizers help run things but can't change modules, co-organizers, ownership or archive.
 */
export const PERMISSIONS = {
  'registrations.view': ['owner', 'co_organizer'],
  'registrations.review': ['owner', 'co_organizer'],
  'registration.toggle': ['owner', 'co_organizer'],
  'players.manage': ['owner', 'co_organizer'],
  'modules.update': ['owner'],
  'coOrganizers.manage': ['owner'],
  'ownership.transfer': ['owner'],
  'tournament.archive': ['owner'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (roles: readonly Role[], permission: Permission) =>
  roles.some((r) => (PERMISSIONS[permission] as readonly Role[]).includes(r));

export interface MyTournament {
  id: string;
  name: string;
  category: string;
  registrationOpen: boolean;
  modules: Modules;
  sport: { code: string; name: string };
  event: { id: string; name: string };
  roles: Role[];
}
