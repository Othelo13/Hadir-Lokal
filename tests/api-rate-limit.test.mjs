import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiRateLimiter } from '../server/api-rate-limit.mjs';

test('requests are limited independently by member and action', () => {
  const limiter = createApiRateLimiter({
    policies: { attendance: { maxRequests: 2, windowMs: 1000 }, photo: { maxRequests: 1, windowMs: 1000 } },
  });
  assert.equal(limiter.allow('member-a', 'attendance', 100), true);
  assert.equal(limiter.allow('member-a', 'attendance', 100), true);
  assert.equal(limiter.allow('member-a', 'attendance', 100), false);
  assert.equal(limiter.allow('member-b', 'attendance', 100), true);
  assert.equal(limiter.allow('member-a', 'photo', 100), true);
  assert.equal(limiter.allow('member-a', 'photo', 100), false);
  assert.equal(limiter.allow('member-a', 'attendance', 1100), true);
});

test('anonymous requests are not assigned an authenticated quota', () => {
  const limiter = createApiRateLimiter({ policies: { photo: { maxRequests: 2, windowMs: 1000 } } });
  assert.equal(limiter.allow('', 'photo', 100), false);
  assert.equal(limiter.allow('member-a', 'non-limited-action', 100), true);
});

test('map capacity does not permanently lock unrelated users', () => {
  const limiter = createApiRateLimiter({
    policies: { photo: { maxRequests: 1, windowMs: 1000 } },
    maxEntries: 2,
  });
  assert.equal(limiter.allow('a', 'photo', 100), true);
  assert.equal(limiter.allow('b', 'photo', 100), true);
  assert.equal(limiter.allow('c', 'photo', 100), true);
  assert.equal(limiter.allow('c', 'photo', 100), false);
});
