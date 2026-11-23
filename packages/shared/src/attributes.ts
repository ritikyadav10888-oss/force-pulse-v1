import { z } from 'zod';
import { optionValue, profileFields, type Field, type RulePack } from './rule-pack';

function valueSchema(field: Field): z.ZodType {
  switch (field.type) {
    case 'select':
      return z.enum(field.options.map(optionValue) as [string, ...string[]]);
    case 'multiselect':
      return z.array(z.enum(field.options.map(optionValue) as [string, ...string[]])).min(1);
    case 'text':
      return z
        .string()
        .trim()
        .min(1)
        .max(field.maxLength ?? 200);
    case 'number': {
      let n = field.integer ? z.number().int() : z.number();
      if (field.min !== undefined) n = n.min(field.min);
      if (field.max !== undefined) n = n.max(field.max);
      return n;
    }
    case 'url':
      return z.url({ protocol: /^https?$/ }).max(500);
    case 'list':
      return z.array(z.string().trim().min(1).max(100)).max(field.maxItems ?? 20);
  }
}

/** Whether a field shows, given current answers (its showIf condition). Used by forms and validation. */
export const isVisible = (field: Field, values: Record<string, unknown>) => {
  if (!field.showIf) return true;
  const current = values[field.showIf.field];
  const picked = Array.isArray(current) ? current : [current];
  return picked.some((v) => field.showIf!.in.includes(v as string));
};

/**
 * Zod schema for a player's sport-profile attributes, generated from the pack (plus common fields).
 * Unknown keys are rejected; hidden fields (showIf not met) are dropped; required applies only when visible.
 */
export function attributesSchema(pack: Pick<RulePack, 'registration'>) {
  const fields = profileFields(pack);
  const shape = Object.fromEntries(fields.map((f) => [f.key, valueSchema(f).optional()]));
  return z
    .object(shape)
    .strict()
    .superRefine(
      (values, ctx) => {
        for (const f of fields) {
          if (f.required && isVisible(f, values) && values[f.key] === undefined) {
            ctx.addIssue({ code: 'custom', message: 'Required', path: [f.key] });
          }
        }
      },
      // Also run when other fields already failed, so a form shows every error at once.
      { when: (payload) => typeof payload.value === 'object' && payload.value !== null },
    )
    .transform((values) =>
      Object.fromEntries(
        fields
          .filter((f) => values[f.key] !== undefined && isVisible(f, values))
          .map((f) => [f.key, values[f.key]]),
      ),
    );
}
