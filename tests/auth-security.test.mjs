import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginLimiter, isAcceptableSetupToken, matchesSetupToken } from '../server/auth-security.mjs';

test('failed attempts on one account do not block another', () => {
  const limiter = createLoginLimiter({ maxAttempts: 3 });
  for (let i = 0; i < 3; i++) limiter.recordFailure('person-a@example.org', 100);
  assert.equal(limiter.isBlocked('person-a@example.org', 100), true);
  assert.equal(limiter.isBlocked('person-b@example.org', 100), false);
  assert.equal(limiter.isBlocked('PERSON-A@example.org', 100), false);
});

test('login rate window expires and success clears failures', () => {
  const limiter = createLoginLimiter({ maxAttempts: 2, windowMs: 100 });
  limiter.recordFailure('a', 100);
  limiter.recordFailure('a', 101);
  assert.equal(limiter.isBlocked('a', 101), true);
  assert.equal(limiter.isBlocked('a', 200), false);
  limiter.recordFailure('a', 201);
  limiter.recordSuccess('a');
  assert.equal(limiter.isBlocked('a', 202), false);
});

test('login limiter has bounded memory behavior', () => {
  const limiter = createLoginLimiter({ maxAttempts: 2, maxEntries: 2 });
  limiter.recordFailure('a', 100);
  limiter.recordFailure('b', 100);
  limiter.recordFailure('c', 100);
  assert.equal(limiter.isBlocked('c', 100), false);
  limiter.recordFailure('c', 100);
  assert.equal(limiter.isBlocked('c', 100), true);
});

test('setup token must be 32 random-looking bytes encoded as hex', () => {
  const valid = '897b1c4d3e9a6f125a3d4c8b76e10f2a9c5b7d3e6f8a1b2c4d5e7f901234abcd';
  assert.equal(valid.length, 64);
  assert.equal(isAcceptableSetupToken(valid), true);
  assert.equal(isAcceptableSetupToken('GANTI_DENGAN_HASIL_GENERATOR_TOKEN_64_KARAKTER_HEKSADESIMAL'), false);
  assert.equal(isAcceptableSetupToken('a'.repeat(64)), false);
  assert.equal(isAcceptableSetupToken('abcd'.repeat(16)), false);
  assert.equal(isAcceptableSetupToken(''), false);
  assert.equal(matchesSetupToken(valid, valid), true);
  assert.equal(matchesSetupToken('a'.repeat(64), valid), false);
});
