import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulePackSchema } from '@force-pulse/shared';
import {
  jsonSchema,
  jsonSchemaPath,
  latestPacks,
  loadPacks,
  lockPath,
  readPackFiles,
} from './index';

const files = readPackFiles();

describe('rule packs', () => {
  it.each(files.map((f) => [f.path, f] as const))(
    '%s is valid and named id/version.json',
    (path, f) => {
      const result = rulePackSchema.safeParse(f.raw);
      expect(result.success, result.error?.message).toBe(true);
      expect(path).toBe(`${result.data!.id}/${result.data!.version}.json`);
    },
  );

  it('seeds the six Gate 1 packs', () => {
    expect(
      latestPacks()
        .map((p) => p.id)
        .sort(),
    ).toEqual(['badminton', 'basketball', 'chess', 'cricket', 'football', 'kabaddi']);
  });

  it('cricket and football carry the full future sections', () => {
    for (const pack of loadPacks().filter((p) => ['cricket', 'football'].includes(p.id))) {
      expect(pack.events && pack.standings && pack.fantasy && pack.overlay, pack.id).toBeTruthy();
    }
  });

  it('published packs are unchanged (immutable) and every pack is locked', () => {
    const lock: Record<string, string> = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const f of files) {
      expect(
        lock[f.path],
        `${f.path} not locked: run "pnpm --filter @force-pulse/rule-packs lock"`,
      ).toBeDefined();
      expect(f.hash, `${f.path} was edited after publishing; add a new version instead`).toBe(
        lock[f.path],
      );
    }
  });

  it('committed JSON Schema matches the Zod schema', () => {
    expect(JSON.parse(readFileSync(jsonSchemaPath, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(jsonSchema())),
    );
  });
});
