import { describe, expect, it } from 'vitest';
import { attributesSchema } from './attributes';
import { rulePackSchema } from './rule-pack';

const base = {
  id: 'testsport',
  version: '1.0.0',
  name: 'Test sport',
  scoringModel: 'sets',
  teamSport: false,
  lineup: { starters: 1, maxSubs: 0, squadMin: 1, squadMax: 2 },
  format: { bestOf: 3, pointsPerSet: 21, winBy: 2 },
  registration: {
    fields: [
      { key: 'role', label: 'Role', type: 'select', required: true, options: ['a', 'b'] },
      {
        key: 'detail',
        label: 'Detail',
        type: 'select',
        required: true,
        options: ['x'],
        showIf: { field: 'role', in: ['b'] },
      },
    ],
  },
};

const issues = (pack: unknown) => {
  const r = rulePackSchema.safeParse(pack);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('rulePackSchema', () => {
  it('accepts a minimal valid pack', () => {
    expect(issues(base)).toEqual([]);
  });

  it('checks format against the scoring model', () => {
    expect(issues({ ...base, format: { periods: 2, periodMinutes: 45 } }).length).toBeGreaterThan(
      0,
    );
    expect(issues({ ...base, format: { ...base.format, bestOf: 2 } })).toContain(
      'bestOf must be odd',
    );
  });

  it('rejects unknown scoring models and bad versions', () => {
    expect(issues({ ...base, scoringModel: 'innings' }).length).toBeGreaterThan(0);
    expect(issues({ ...base, version: '1.0' }).length).toBeGreaterThan(0);
  });

  it('rejects duplicate keys, including clashes with common fields', () => {
    const dup = { key: 'experienceLevel', label: 'X', type: 'text' };
    expect(issues({ ...base, registration: { fields: [dup] } })).toContain(
      'duplicate field key "experienceLevel"',
    );
  });

  it('rejects showIf pointing at a missing field or a non-option value', () => {
    const bad = (showIf: unknown) => ({
      ...base,
      registration: {
        fields: [base.registration.fields[0], { key: 'z', label: 'Z', type: 'text', showIf }],
      },
    });
    expect(issues(bad({ field: 'nope', in: ['a'] }))[0]).toMatch(/must be an earlier/);
    expect(issues(bad({ field: 'role', in: ['c'] }))).toContain(
      'showIf value "c" is not an option',
    );
  });

  it('rejects overlay popups that are not events and unknown top-level keys', () => {
    expect(
      issues({ ...base, events: ['goal'], overlay: { scorebug: ['score'], popups: ['red'] } }),
    ).toContain('overlay popup "red" is not in events');
    expect(issues({ ...base, extra: 1 }).length).toBeGreaterThan(0);
  });
});

describe('attributesSchema', () => {
  const schema = attributesSchema(rulePackSchema.parse(base));

  it('requires required fields (common and pack) and checks options', () => {
    const r = schema.safeParse({ role: 'c' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['role', 'experienceLevel']),
    );
  });

  it('applies showIf: hidden fields are not required and are dropped', () => {
    expect(schema.parse({ experienceLevel: 'club', role: 'a', detail: 'x' })).toEqual({
      experienceLevel: 'club',
      role: 'a',
    });
    expect(schema.safeParse({ experienceLevel: 'club', role: 'b' }).success).toBe(false);
    expect(schema.parse({ experienceLevel: 'club', role: 'b', detail: 'x' })).toMatchObject({
      detail: 'x',
    });
  });

  it('rejects unknown keys and non-http URLs', () => {
    expect(schema.safeParse({ experienceLevel: 'club', role: 'a', hack: 1 }).success).toBe(false);
    expect(
      schema.safeParse({
        experienceLevel: 'club',
        role: 'a',
        highlightVideo: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });
});
