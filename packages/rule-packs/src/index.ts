import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { rulePackSchema, type RulePack } from '@force-pulse/shared';

export const packsDir = join(__dirname, '..', 'packs');
export const lockPath = join(__dirname, '..', 'packs.lock.json');
export const jsonSchemaPath = join(__dirname, '..', 'schema', 'rule-pack.schema.json');

export interface PackFile {
  /** "cricket/1.0.0.json" */
  path: string;
  raw: unknown;
  /** sha256 of the canonical JSON, so whitespace and line endings don't count as edits. */
  hash: string;
}

export function readPackFiles(): PackFile[] {
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(join(packsDir, d.name))
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const raw: unknown = JSON.parse(readFileSync(join(packsDir, d.name, f), 'utf8'));
          const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
          return { path: `${d.name}/${f}`, raw, hash };
        }),
    );
}

/** All published packs, validated. Throws on the first invalid pack. */
export function loadPacks(): RulePack[] {
  return readPackFiles().map(({ path, raw }) => {
    const result = rulePackSchema.safeParse(raw);
    if (!result.success) throw new Error(`${path}: ${result.error.message}`);
    return result.data;
  });
}

const semverParts = (v: string) => v.split('.').map(Number) as [number, number, number];

/** Highest version per pack id. */
export function latestPacks(packs: RulePack[] = loadPacks()): RulePack[] {
  const byId = new Map<string, RulePack>();
  for (const p of packs) {
    const cur = byId.get(p.id);
    const [a, b] = [semverParts(p.version), cur && semverParts(cur.version)];
    if (!b || a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) {
      byId.set(p.id, p);
    }
  }
  return [...byId.values()];
}

/** JSON Schema for editors and other tools; Zod refinements (cross-field checks) are not representable. */
export const jsonSchema = () => z.toJSONSchema(rulePackSchema, { unrepresentable: 'any' });
