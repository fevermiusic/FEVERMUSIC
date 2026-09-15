// tests/syntax.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IGNORE_DIRS = new Set(['node_modules', 'tests', '.git']);

function findJsFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(findJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

for (const file of findJsFiles(ROOT)) {
  const rel = path.relative(ROOT, file);
  test(`sintaxis válida: ${rel}`, () => {
    assert.doesNotThrow(() => execFileSync('node', ['--check', file], { stdio: 'pipe' }));
  });
}
