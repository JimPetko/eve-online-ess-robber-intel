const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

/**
 * Counts failed sign-ins per username (any case) and per IP over a sliding 15 minutes. After 10
 * failures for either, further attempts are refused until the oldest of them leaves the window.
 * In memory, so a restart forgets it.
 */
export interface SignInThrottle {
  /** Seconds until an attempt from this username and IP is allowed again; 0 when it is allowed now. */
  retryAfterSeconds(username: string, ip: string): number;
  recordFailure(username: string, ip: string): void;
  /** Clears the username's failures, not the IP's: one good password must not unlock guessing others. */
  recordSuccess(username: string): void;
}

export function createSignInThrottle(now: () => Date): SignInThrottle {
  const failures = new Map<string, number[]>();
  const userKey = (username: string) => `user:${username.toLowerCase()}`;
  const keys = (username: string, ip: string) => [userKey(username), `ip:${ip}`];

  function recent(key: string, at: number): number[] {
    const kept = (failures.get(key) ?? []).filter((t) => t > at - WINDOW_MS);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
    return kept;
  }

  return {
    retryAfterSeconds(username, ip) {
      const at = now().getTime();
      let waitMs = 0;
      for (const key of keys(username, ip)) {
        const times = recent(key, at);
        const unblocking = times[times.length - MAX_FAILURES];
        if (unblocking !== undefined) waitMs = Math.max(waitMs, unblocking + WINDOW_MS - at);
      }
      return Math.ceil(waitMs / 1000);
    },
    recordFailure(username, ip) {
      const at = now().getTime();
      for (const key of keys(username, ip)) failures.set(key, [...recent(key, at), at]);
      if (failures.size > 10_000) for (const key of [...failures.keys()]) recent(key, at);
    },
    recordSuccess(username) {
      failures.delete(userKey(username));
    },
  };
}
