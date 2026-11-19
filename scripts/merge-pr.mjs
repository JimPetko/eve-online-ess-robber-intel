#!/usr/bin/env node
// The only sanctioned way to merge. GitHub branch protection is unavailable on this plan,
// so this script is the gate. Usage: node scripts/merge-pr.mjs <pr-number>
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REQUIRED = ["check", "tests-required"];
const PASSING = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

/** Returns the reasons the PR may not merge; empty means it may. */
export function blockers(pr) {
  const reasons = [];
  if (pr.isDraft) reasons.push("PR is a draft");
  if (pr.mergeable !== "MERGEABLE") reasons.push(`mergeable is ${pr.mergeable}`);
  const checks = (pr.statusCheckRollup ?? []).map((c) =>
    c.__typename === "StatusContext"
      ? { name: c.context, done: c.state !== "PENDING" && c.state !== "EXPECTED", result: c.state }
      : { name: c.name, done: c.status === "COMPLETED", result: c.conclusion },
  );
  for (const c of checks) {
    if (!c.done) reasons.push(`check ${c.name} is pending`);
    else if (REQUIRED.includes(c.name) ? c.result !== "SUCCESS" : !PASSING.has(c.result))
      reasons.push(`check ${c.name} concluded ${c.result}`);
  }
  for (const name of REQUIRED)
    if (!checks.some((c) => c.name === name)) reasons.push(`required check ${name} has not run on the head commit`);
  return reasons;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function main([pr]) {
  if (!pr) {
    console.error("usage: node scripts/merge-pr.mjs <pr-number>");
    return 2;
  }
  // GitHub computes mergeability lazily; UNKNOWN on first read is normal.
  let view = JSON.parse(gh(["pr", "view", pr, "--json", "isDraft,mergeable,headRefOid,statusCheckRollup"]));
  for (let i = 0; i < 5 && view.mergeable === "UNKNOWN"; i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    view = JSON.parse(gh(["pr", "view", pr, "--json", "isDraft,mergeable,headRefOid,statusCheckRollup"]));
  }
  const reasons = blockers(view);
  if (reasons.length > 0) {
    console.error(`merge-pr: refusing to merge #${pr} at ${view.headRefOid}:`);
    for (const r of reasons) console.error(`  ${r}`);
    return 1;
  }
  gh(["pr", "merge", pr, "--squash", "--delete-branch", "--match-head-commit", view.headRefOid]);
  console.log(`merge-pr: merged #${pr} at ${view.headRefOid}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
