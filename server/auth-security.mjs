import { createHash, timingSafeEqual } from 'node:crypto';

// Require the format emitted by randomBytes(32).toString('hex') and reject
// trivial, repeated, or obvious placeholder values. Format checks cannot
// prove entropy: administrators must use a cryptographic random generator.
export function isAcceptableSetupToken(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) return false;
  const bytes = Buffer.from(value, 'hex');
  if (new Set(bytes).size < 16) return false;
  for (const length of [1, 2, 4, 8, 16]) {
    if (bytes.every((byte, i) => byte === bytes[i % length])) return false;
  }
  return true;
}

export function matchesSetupToken(submitted, expected) {
  if (!isAcceptableSetupToken(expected) ||
      typeof submitted !== 'string' || !/^[a-f0-9]{64}$/i.test(submitted))
    return false;
  const provided = createHash('sha256').update(submitted).digest();
  const configured = createHash('sha256').update(expected).digest();
  return timingSafeEqual(provided, configured);
}

// Failed logins are counted separately for each account identifier.
// A bounded map prevents unbounded memory growth from arbitrary usernames.
// Source-IP rate limiting belongs at the trusted HTTPS ingress, which knows
// the real client address instead of a potentially shared reverse-proxy IP.
export function createLoginLimiter({
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000,
  maxEntries = 10000,
} = {}) {
  const attempts = new Map();
  const keyFor = (identifier) => createHash('sha256').update(identifier).digest('hex');

  const getActive = (key, now) => {
    const entry = attempts.get(key);
    if (entry && entry.until > now) return entry;
    if (entry) attempts.delete(key);
    return null;
  };

  function isBlocked(identifier, now = Date.now()) {
    const key = keyFor(identifier);
    const entry = getActive(key, now);
    return !!entry && entry.count >= maxAttempts;
  }

  function recordFailure(identifier, now = Date.now()) {
    const key = keyFor(identifier);
    const previous = getActive(key, now);
    if (previous) {
      previous.count++;
      return;
    }

    if (attempts.size >= maxEntries) {
      for (const [entryKey, entry] of attempts) {
        if (entry.until <= now) attempts.delete(entryKey);
      }
    }
    // Evict the oldest entry rather than locking everyone out when capacity
    // is reached. The reverse proxy should enforce additional source limits.
    if (attempts.size >= maxEntries) attempts.delete(attempts.keys().next().value);
    attempts.set(key, { count: 1, until: now + windowMs });
  }

  function recordSuccess(identifier) {
    attempts.delete(keyFor(identifier));
  }

  return { isBlocked, recordFailure, recordSuccess };
}
