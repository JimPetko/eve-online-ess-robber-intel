import type { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";
import { createAccount } from "./auth/routes.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./store/db.ts";

const BOM = String.fromCodePoint(0xfeff);
const USAGE = 'usage: accounts-cli create-admin "<username>"   (the password is the first line of stdin)';

export interface CliResult {
  readonly exitCode: 0 | 1;
  readonly output: string;
}

/** The first line, without the byte-order mark Windows PowerShell puts in front of piped text. */
async function firstLine(input: NodeJS.ReadableStream): Promise<string> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) return line.startsWith(BOM) ? line.slice(1) : line;
  return "";
}

/**
 * `create-admin <username>`, reading the password from the first line of `stdin`: the first Admin,
 * so its password never has to live in the repo. Like every new Account it must change its password
 * at first sign-in.
 */
export async function accountsCli(
  db: DatabaseSync,
  args: readonly string[],
  stdin: NodeJS.ReadableStream,
  now: Date,
): Promise<CliResult> {
  const [command, username, ...rest] = args;
  if (command !== "create-admin" || username === undefined || rest.length > 0) return { exitCode: 1, output: USAGE };
  const created = await createAccount(db, { username, password: await firstLine(stdin), role: "admin" }, now);
  if ("status" in created) return { exitCode: 1, output: `${created.body.error}: ${created.body.message}` };
  return { exitCode: 0, output: JSON.stringify(created) };
}

if (import.meta.main) {
  const db = openDb(loadConfig().dbPath);
  const result = await accountsCli(db, process.argv.slice(2), process.stdin, new Date());
  db.close();
  if (result.exitCode === 0) console.log(result.output);
  else console.error(result.output);
  process.exit(result.exitCode);
}
