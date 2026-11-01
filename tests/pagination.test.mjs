import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/pagination.ts';

test('pagination presents 10 filtered records by default without mutating input', () => {
  const records = Array.from({ length: 34 }, (_, i) => i + 1);
  const first = paginate(records, 1, 10);
  assert.deepEqual(first.rows, records.slice(0, 10));
  assert.equal(first.from, 1);
  assert.equal(first.to, 10);
  assert.equal(first.totalPages, 4);
  assert.equal(records.length, 34);
});

test('last page and out-of-range requests are handled safely', () => {
  const records = Array.from({ length: 23 }, (_, i) => i);
  const last = paginate(records, 999, 20);
  assert.equal(last.page, 2);
  assert.equal(last.from, 21);
  assert.equal(last.to, 23);
  assert.deepEqual(last.rows, [20, 21, 22]);
  assert.equal(paginate(records, -10, 50).page, 1);
});

test('empty filter results do not create invalid page counters', () => {
  const result = paginate([], 4, 10);
  assert.equal(result.totalPages, 1);
  assert.equal(result.page, 1);
  assert.equal(result.from, 0);
  assert.equal(result.to, 0);
  assert.deepEqual(result.rows, []);
});

test('pagination selection is independent of Excel export dataset', () => {
  const records = Array.from({ length: 75 }, (_, i) => ({ id: i }));
  const filtered = records.filter((r) => r.id % 2 === 0);
  const selected = paginate(filtered, 2, 20);
  assert.equal(selected.rows.length, 18);
  assert.equal(filtered.length, 38);
  assert.equal(records.length, 75);
  assert.deepEqual(selected.rows, filtered.slice(20, 40));
});
