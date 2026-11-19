#!/usr/bin/env node
// Fails when a diff changes behaviour code under src/ without changing a test.
// Usage: node scripts/tests-required.mjs <base> <head>
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TEST = /\.test\.tsx?$/;
const NON_BEHAVIOUR = /(\.d\.ts|\.json|\.css|\.html|\.svg|\.png|\.jpe?g|\.gif|\.ico|\.webp|\.md)$/;

/** @param {string[]} files */
export function classify(files) {
  const src = files.filter((f) => f.startsWith("src/"));
  const tests = src.filter((f) => TEST.test(f));
  const behaviour = src.filter((f) => !TEST.test(f) && !NON_BEHAVIOUR.test(f));
  return { ok: behaviour.length === 0 || tests.length > 0, behaviour, tests };
}

function main([base, head]) {
  if (!base || !head) {
    console.error("usage: node scripts/tests-required.mjs <base> <head>");
    return 2;
  }
  const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8" });
  const result = classify(out.split("\n").filter(Boolean));
  if (result.ok) {
    console.log(
      `tests-required: ok (${String(result.behaviour.length)} behaviour files, ${String(result.tests.length)} test files)`,
    );
    return 0;
  }
  console.error("tests-required: behaviour code changed with no *.test.ts(x) change:");
  for (const f of result.behaviour) console.error(`  ${f}`);
  console.error("Add tests, or label the PR `no-tests-needed` if no behaviour changed (see CLAUDE.md).");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
