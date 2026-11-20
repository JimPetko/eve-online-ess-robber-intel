const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

/**
 * Counts failed sign-ins per username (any case) and per IP over a sliding 15 minutes. After 10
 * failures for either, further attempts are refused until the oldest of them leaves the window.
 * In memory, so a restart forgets it.
 */
export interface SignInThrottle {
  /**
   * Runs `verify` as one attempt for this username and IP, or refuses it without running it. An
   * attempt counts against the limit from the moment it starts, so requests sent at once cannot all
   * start before the first failure is recorded. `false` or a throw records a failure; `true` clears
   * the username's failures, not the IP's: one good password must not unlock guessing others.
   */
  attempt(username: string, ip: string, verify: () => Promise<boolean>): Promise<boolean | { readonly retryAfterSeconds: number }>;
}

export function createSignInThrottle(now: () => Date): SignInThrottle {
  const failures = new Map<string, number[]>();
  const inFlight = new Map<string, number>();
  const userKey = (username: string) => `user:${username.toLowerCase()}`;

  function recent(key: string, at: number): number[] {
    const kept = (failures.get(key) ?? []).filter((t) => t > at - WINDOW_MS);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
    return kept;
  }

  /** An attempt still in flight counts as a failure at `at`, the latest it could be recorded. */
  function waitMs(key: string, at: number): number {
    const times = [...recent(key, at), ...Array<number>(inFlight.get(key) ?? 0).fill(at)];
    const unblocking = times[times.length - MAX_FAILURES];
    return unblocking === undefined ? 0 : unblocking + WINDOW_MS - at;
  }

  function addInFlight(keys: readonly string[], by: 1 | -1): void {
    for (const key of keys) {
      const count = (inFlight.get(key) ?? 0) + by;
      if (count === 0) inFlight.delete(key);
      else inFlight.set(key, count);
    }
  }

  return {
    async attempt(username, ip, verify) {
      const keys = [userKey(username), `ip:${ip}`];
      const startedAt = now().getTime();
      const wait = Math.max(...keys.map((key) => waitMs(key, startedAt)));
      if (wait > 0) return { retryAfterSeconds: Math.ceil(wait / 1000) };

      addInFlight(keys, 1);
      let verified = false;
      try {
        verified = await verify();
        return verified;
      } finally {
        addInFlight(keys, -1);
        const at = now().getTime();
        if (verified) failures.delete(userKey(username));
        else for (const key of keys) failures.set(key, [...recent(key, at), at]);
        if (failures.size > 10_000) for (const key of [...failures.keys()]) recent(key, at);
      }
    },
  };
}
