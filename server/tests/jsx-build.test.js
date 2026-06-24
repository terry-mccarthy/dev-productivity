import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function getStrippedJsx() {
  const jsx = readFileSync(join(ROOT, 'dev-productivity.jsx'), 'utf8');
  return jsx
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+default\s+/gm, '');
}

test('stripping leaves no import statements in JSX source', () => {
  const stripped = getStrippedJsx();
  const importLines = stripped.split('\n').filter(l => /^\s*import\s/.test(l));
  assert.equal(importLines.length, 0, `Found surviving imports:\n${importLines.join('\n')}`);
});

test('index.html uses Babel classic runtime to prevent automatic import injection', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const hasClassic = html.includes("runtime: 'classic'") || html.includes('runtime: "classic"');
  assert.ok(hasClassic, 'Babel preset-react must specify runtime: "classic" — automatic runtime injects import statements that break inline scripts');
});
