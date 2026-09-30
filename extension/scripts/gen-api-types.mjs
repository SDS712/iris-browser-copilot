// Generates src/core/api-types.ts from the backend's openapi.json.
// The output is committed; CI regenerates it and fails if it changed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const root = join(import.meta.dirname, '..');
const source = JSON.parse(readFileSync(join(root, '..', 'backend', 'openapi.json'), 'utf8'));
const ast = await openapiTS(source, { alphabetize: true });
const header =
  '// Generated from backend/openapi.json by scripts/gen-api-types.mjs. Do not edit.\n\n';
const target = join(root, 'src', 'core', 'api-types.ts');
writeFileSync(target, header + astToString(ast));
console.log(`Wrote ${target}`);
