# P4.1 — Frontend recap foundation

Typed response contracts for the existing list and detail endpoints, a GET-only same-origin client with no-store, AbortSignal support and typed HTTP errors, and pure presentation helpers. The existing dashboard is deliberately not replaced in this increment; P4.2 will wire the actual table and request lifecycle. P4.3 adds filters/pagination. No backend, database, authentication, or legacy export behavior changes.

Unknown historic timezones display explicitly labeled UTC instead of pretending the event occurred in the current office timezone. Missing status uses dash. Notes are non-sensitive, with issue warnings prioritized over approval, review or cancellation labels. The detail types allow legacy record status/kind/review strings. TypeScript types describe the server contract, not full runtime schema validation; malformed nonobject successful responses are rejected. Backend remains authoritative for role checks and status. No persistent caching or storage of sensitive recap data.

Eight tests cover query encoding, default date, detail identity, HTTP errors, aborts, presentation and coverage. Next steps must clear stale data on identity changes, cancel in-flight reads on filter/unmount, and reload on successful mutations. No new dependencies.
