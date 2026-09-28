/**
 * Failure limiters (docs/AGENT_LINK.md §A.2, §B.1): count failed attempts per key (a client address, an
 * MCP session) in a sliding window, and refuse the key once it has `max` failures in the window. Only
 * failures are counted, so a person who gets it right is never slowed down.
 *
 *   login (MCP `login`, /api/me, /api/owls with an unknown key): LOGIN_FAIL_PER_IP_PER_MIN per address;
 *   forge_item: FORGE_FAIL_PER_MIN per MCP session.
 * Pairing codes are limited in the kernel (World.redeemPairCode(code, source): per address and per realm).
 */
export class FailWindow {
  private fails = new Map<string, number[]>();

  constructor(readonly max: number, readonly windowMs = 60_000) {}

  private recent(key: string, now: number) {
    const xs = this.fails.get(key);
    if (!xs) return [];
    const r = xs.filter((t) => now - t < this.windowMs);
    if (r.length) this.fails.set(key, r);
    else this.fails.delete(key);
    return r;
  }

  /** May `key` try (again)? False once it has `max` failures in the window. */
  allowed(key: string, now = Date.now()) {
    return this.recent(key, now).length < this.max;
  }

  /** Record a failure for `key`. */
  fail(key: string, now = Date.now()) {
    const r = this.recent(key, now);
    r.push(now);
    this.fails.set(key, r);
    if (this.fails.size > 10_000) this.prune(now);
  }

  /** Seconds until `key` may try again (0 if it may now). */
  retryAfter(key: string, now = Date.now()) {
    const r = this.recent(key, now);
    if (r.length < this.max) return 0;
    return Math.max(1, Math.ceil((r[r.length - this.max] + this.windowMs - now) / 1000));
  }

  private prune(now: number) {
    for (const k of [...this.fails.keys()]) this.recent(k, now);
  }
}
