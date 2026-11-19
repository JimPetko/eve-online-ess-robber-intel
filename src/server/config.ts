import { readFileSync } from "node:fs";

export interface Config {
  readonly dbPath: string;
  readonly userAgent: string;
}

const CONTACT = "petko.james@gmail.com";

function packageVersion(): string {
  // Same relative path from src/server and dist/server.
  const raw: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  if (typeof raw === "object" && raw !== null && "version" in raw && typeof raw.version === "string") {
    return raw.version;
  }
  throw new Error("package.json has no version");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbPath: env.DB_PATH ?? "data/ess-robber-intel.sqlite",
    userAgent: `ess-robber-intel/${packageVersion()} (${CONTACT})`,
  };
}
