// Lightweight per-user API rate limits. The authenticated member ID comes from
// the server-side session; never use client-provided IP headers or user IDs.
// This is defense in depth, not a substitute for an ingress-wide rate limit.
const POLICIES = Object.freeze({
  state: { maxRequests: 180, windowMs: 5 * 60 * 1000 },
  photo: { maxRequests: 120, windowMs: 5 * 60 * 1000 },
  challenge: { maxRequests: 24, windowMs: 5 * 60 * 1000 },
  attendance: { maxRequests: 12, windowMs: 5 * 60 * 1000 },
});

export function createApiRateLimiter({ policies = POLICIES, maxEntries = 10000 } = {}) {
  const entries = new Map();

  function allow(userId, action, now = Date.now()) {
    const policy = policies[action];
    if (!policy) return true;
    if (typeof userId !== 'string' || !userId) return false;

    const key = `${userId}:${action}`;
    const active = entries.get(key);
    if (active && active.until > now) {
      if (active.count >= policy.maxRequests) return false;
      active.count++;
      return true;
    }
    if (active) entries.delete(key);

    if (entries.size >= maxEntries) {
      for (const [itemKey, item] of entries)
        if (item.until <= now) entries.delete(itemKey);
    }
    // Do not turn table saturation into a global lockout.
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    entries.set(key, { count: 1, until: now + policy.windowMs });
    return true;
  }

  return { allow };
}

export const apiRateLimiter = createApiRateLimiter();
