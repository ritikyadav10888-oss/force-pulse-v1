// `pnpm --filter @force-pulse/rule-packs lock`: run after ADDING a new pack version.
// Records each pack's hash (published versions are immutable) and regenerates the JSON Schema.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { jsonSchema, jsonSchemaPath, loadPacks, lockPath, readPackFiles } from './index';

loadPacks(); // refuse to lock invalid packs

const existing: Record<string, string> = JSON.parse(readFileSync(lockPath, 'utf8'));
const lock = { ...existing };
for (const { path, hash } of readPackFiles()) {
  if (existing[path] && existing[path] !== hash) {
    throw new Error(`${path} is published and must not change. Add a new version instead.`);
  }
  lock[path] = hash;
}
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

mkdirSync(dirname(jsonSchemaPath), { recursive: true });
writeFileSync(jsonSchemaPath, JSON.stringify(jsonSchema(), null, 2) + '\n');
console.log(`Locked ${Object.keys(lock).length} packs; wrote JSON Schema.`);
