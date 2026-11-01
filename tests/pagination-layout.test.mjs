import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('sidebar navigation styling does not force pagination into a column', () => {
  assert.match(css, /^\.sidebar > nav \{/m);
  assert.doesNotMatch(css, /^nav \{/m);
  assert.match(css, /\.history-page-nav\s*\{[^}]*flex-direction:\s*row;/s);
});

test('sidebar button styles only apply inside sidebar', () => {
  assert.match(css, /^\.sidebar > nav button \{/m);
  assert.doesNotMatch(css, /^nav button \{/m);
});
