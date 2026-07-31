// tests/views-sync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('views/*.html está sincronizado con lo que router.js realmente usa', () => {
  try {
    execFileSync('node', [path.join(__dirname, '..', 'scripts', 'check-views-sync.js')], { stdio: 'pipe' });
  } catch (err) {
    assert.fail(
      'Alguna vista en views/ quedó desactualizada respecto a router.js.\n' +
      (err.stdout ? err.stdout.toString() : '') +
      (err.stderr ? err.stderr.toString() : '')
    );
  }
});
