import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createEsi } from "./esi/client.ts";
import { openDb } from "./store/db.ts";
import { startScheduler } from "./sync/scheduler.ts";

/** How long shutdown waits for a sync in progress. Every write is a transaction, so cutting one off is safe. */
const SHUTDOWN_GRACE_MS = 10_000;

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const config = loadConfig();

const db = openDb(config.dbPath);
const scheduler = startScheduler({
  esi: createEsi({ userAgent: config.userAgent }),
  db,
  log: (line) => {
    console.log(line);
  },
});

// Same relative path from src/server and dist/server.
const webRoot = fileURLToPath(new URL("../../dist/web", import.meta.url));
const app = buildApp({
  db,
  nextPullAt: () => scheduler.nextKillsPollAt(),
  webRoot,
  trustProxy: process.env.TRUST_PROXY === "1",
});
const address = await app.listen({ port, host });
console.log(`Listening on ${address}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: shutting down`);
  const grace = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref());
  await Promise.all([app.close(), Promise.race([scheduler.stop(), grace])]);
  db.close();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}
