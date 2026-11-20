/** Each scrypt hash or verification holds about 32 MiB and 50 ms of a libuv thread, of which Node has 4. */
const MAX_IN_FLIGHT = 4;

/**
 * Caps password hashing server-wide. The sign-in throttle counts per username and per IP, so a flood
 * of distinct usernames from many IPs passes it; this stops that flood from exhausting memory or CPU.
 */
export interface HashingLimit {
  /** Runs `work` if fewer than 4 are running, else answers "busy" without running it. */
  run<T>(work: () => Promise<T>): Promise<T | "busy">;
}

export function createHashingLimit(): HashingLimit {
  let inFlight = 0;
  return {
    async run(work) {
      if (inFlight >= MAX_IN_FLIGHT) return "busy";
      inFlight++;
      try {
        return await work();
      } finally {
        inFlight--;
      }
    },
  };
}
