import { z } from 'zod';

export const ROLES = [
  'super_admin',
  'organizer',
  'auctioneer',
  'team_owner',
  'player',
  'scorer',
] as const;
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
  user: { id: string; email: string; name: string; avatarUrl: string | null };
  /** Global roles have tournamentId null. */
  roles: { role: Role; tournamentId: string | null }[];
  player: { id: string; displayName: string } | null;
  /** required = true until the user consents to data use under the current policy version. */
  consent: { policyVersion: string; scopes: ConsentScope[]; required: boolean };
}
