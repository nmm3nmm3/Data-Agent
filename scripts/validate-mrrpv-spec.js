#!/usr/bin/env node
/**
 * Validates that the MRRpV spec document exists and contains required sections.
 * Run from repo root: node scripts/validate-mrrpv-spec.js
 * Exit code 0 = pass, 1 = fail.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const specPath = path.join(repoRoot, 'docs', 'MRRpV-spec.md');

const requiredSections = [
  '## Definition (business terms)',
  '## Source (tables and columns)',
  '## Denominator (vehicle definition)',
];

function main() {
  if (!fs.existsSync(specPath)) {
    console.error('FAIL: docs/MRRpV-spec.md not found.');
    process.exit(1);
  }
  const content = fs.readFileSync(specPath, 'utf8');
  const missing = requiredSections.filter((s) => !content.includes(s));
  if (missing.length > 0) {
    console.error('FAIL: MRRpV spec is missing required sections:', missing);
    process.exit(1);
  }
  console.log('OK: MRRpV spec exists and has Definition, Source, Denominator.');
  process.exit(0);
}

main();
