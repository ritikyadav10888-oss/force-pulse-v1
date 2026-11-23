import { z } from 'zod';

// ADR-001: the core never names a sport. Everything sport-specific is data in a versioned pack,
// and scoring (later phases) is one of these six models.
export const SCORING_MODELS = [
  'ball',
  'timed_goal',
  'raid',
  'timed_points',
  'sets',
  'result_only',
] as const;
export const scoringModelSchema = z.enum(SCORING_MODELS);
export type ScoringModel = z.infer<typeof scoringModelSchema>;

const key = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'camelCase key');
const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'semantic version x.y.z');
const posInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();

// An option is a plain value or { value, label, group } (group lets e.g. "CB" roll up to "DEF").
export const fieldOptionSchema = z.union([
  z.string().min(1),
  z.object({
    value: z.string().min(1),
    label: z.string().optional(),
    group: z.string().optional(),
  }),
]);
export type FieldOption = z.infer<typeof fieldOptionSchema>;

// Show this field only when another select/multiselect field has one of these values.
const showIfSchema = z.object({ field: key, in: z.array(z.string()).min(1) });

const fieldBase = {
  key,
  label: z.string().min(1),
  help: z.string().optional(),
  required: z.boolean().optional(),
  showIf: showIfSchema.optional(),
};

export const fieldSchema = z.discriminatedUnion('type', [
  z.object({ ...fieldBase, type: z.literal('select'), options: z.array(fieldOptionSchema).min(1) }),
  z.object({
    ...fieldBase,
    type: z.literal('multiselect'),
    options: z.array(fieldOptionSchema).min(1),
  }),
  z.object({ ...fieldBase, type: z.literal('text'), maxLength: posInt.optional() }),
  z.object({
    ...fieldBase,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
  }),
  z.object({ ...fieldBase, type: z.literal('url') }),
  z.object({ ...fieldBase, type: z.literal('list'), maxItems: posInt.optional() }),
]);
export type Field = z.infer<typeof fieldSchema>;

export const lineupSchema = z.object({
  starters: posInt,
  maxSubs: nonNegInt,
  squadMin: posInt,
  squadMax: posInt,
  positionMin: z.record(z.string(), posInt).optional(),
});

// Format shape depends on the scoring model.
const formatByModel = {
  ball: z.object({
    innings: z.union([z.literal(1), z.literal(2)]),
    oversPerInnings: posInt,
    ballsPerOver: posInt,
    maxOversPerBowler: posInt.optional(),
    powerplayOvers: nonNegInt.optional(),
    superOver: z.boolean(),
  }),
  timed_goal: z.object({
    periods: posInt,
    periodMinutes: posInt,
    extraTime: z.boolean(),
    extraTimeMinutes: posInt.optional(),
    shootout: z.boolean(),
  }),
  raid: z.object({
    halves: posInt,
    halfMinutes: posInt,
    raidSeconds: posInt,
    playersOnMat: posInt,
  }),
  timed_points: z.object({
    periods: posInt,
    periodMinutes: posInt,
    overtimeMinutes: posInt,
    shotClockSeconds: posInt.optional(),
  }),
  sets: z.object({
    bestOf: posInt.refine((n) => n % 2 === 1, 'bestOf must be odd'),
    pointsPerSet: posInt,
    winBy: posInt,
    pointCap: posInt.optional(),
  }),
  result_only: z.object({ draws: z.boolean(), timeControl: z.string().optional() }),
} satisfies Record<ScoringModel, z.ZodType>;

// Sections no Gate 1 code reads yet; validated now to prove the format before scoring is built.
const standingsSchema = z.object({
  win: z.number(),
  loss: z.number(),
  draw: z.number().optional(),
  tie: z.number().optional(),
  noResult: z.number().optional(),
  tiebreakers: z.array(z.string()).min(1),
});
const fantasySchema = z.object({
  squad: posInt,
  credits: z.number().positive(),
  points: z.record(z.string(), z.number()),
});
const overlaySchema = z.object({
  scorebug: z.array(z.string()).min(1),
  popups: z.array(z.string()),
});

const envelope = {
  $schema: z.string().optional(),
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  version: semver,
  name: z.string().min(1),
  teamSport: z.boolean(),
  registration: z.object({ fields: z.array(fieldSchema) }),
  lineup: lineupSchema,
  events: z.array(z.string().min(1)).min(1).optional(),
  standings: standingsSchema.optional(),
  fantasy: fantasySchema.optional(),
  overlay: overlaySchema.optional(),
};

const packVariant = <M extends ScoringModel>(model: M) =>
  z.object({ ...envelope, scoringModel: z.literal(model), format: formatByModel[model] }).strict();

export const rulePackSchema = z
  .discriminatedUnion('scoringModel', [
    packVariant('ball'),
    packVariant('timed_goal'),
    packVariant('raid'),
    packVariant('timed_points'),
    packVariant('sets'),
    packVariant('result_only'),
  ])
  .superRefine((pack, ctx) => {
    const seen = new Map<string, Field>();
    for (const [i, field] of [...COMMON_FIELDS, ...pack.registration.fields].entries()) {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate field key "${field.key}"`,
          path: ['registration', 'fields', i],
        });
      }
      if (field.showIf) {
        const target = seen.get(field.showIf.field);
        const values = target && 'options' in target ? target.options.map(optionValue) : null;
        if (!values) {
          ctx.addIssue({
            code: 'custom',
            message: `showIf.field "${field.showIf.field}" must be an earlier select/multiselect field`,
            path: ['registration', 'fields', i, 'showIf'],
          });
        } else {
          for (const v of field.showIf.in.filter((v) => !values.includes(v))) {
            ctx.addIssue({
              code: 'custom',
              message: `showIf value "${v}" is not an option`,
              path: ['registration', 'fields', i, 'showIf'],
            });
          }
        }
      }
      seen.set(field.key, field);
    }
    const { squadMin, squadMax, starters } = pack.lineup;
    if (squadMin > squadMax || starters > squadMax) {
      ctx.addIssue({
        code: 'custom',
        message: 'need starters <= squadMax and squadMin <= squadMax',
        path: ['lineup'],
      });
    }
    if (pack.overlay && pack.events) {
      for (const p of pack.overlay.popups.filter((p) => !pack.events!.includes(p))) {
        ctx.addIssue({
          code: 'custom',
          message: `overlay popup "${p}" is not in events`,
          path: ['overlay', 'popups'],
        });
      }
    }
  });
export type RulePack = z.infer<typeof rulePackSchema>;

export const optionValue = (o: FieldOption) => (typeof o === 'string' ? o : o.value);

// Same for every sport, so kept here rather than copied into six packs. Still pure data.
export const COMMON_FIELDS: Field[] = [
  {
    key: 'experienceLevel',
    label: 'Experience level',
    type: 'select',
    required: true,
    options: ['beginner', 'club', 'district', 'state', 'national'],
  },
  { key: 'yearsPlayed', label: 'Years played', type: 'number', min: 0, max: 60, integer: true },
  { key: 'highlightVideo', label: 'Highlight video link', type: 'url' },
  { key: 'pastTeams', label: 'Past teams', type: 'list', maxItems: 20 },
];

/** All fields a sport profile form shows for this pack: common fields first, then the pack's own. */
export const profileFields = (pack: Pick<RulePack, 'registration'>): Field[] => [
  ...COMMON_FIELDS,
  ...pack.registration.fields,
];
