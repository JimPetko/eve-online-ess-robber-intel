import { describe, expect, it } from "vitest";
import { blockers } from "./merge-pr.mjs";

const run = (name, status, conclusion) => ({ __typename: "CheckRun", name, status, conclusion });
const checkOk = run("check", "COMPLETED", "SUCCESS");
const testsOk = run("tests-required", "COMPLETED", "SUCCESS");
const dockerOk = run("docker", "COMPLETED", "SUCCESS");
const green = { isDraft: false, mergeable: "MERGEABLE", statusCheckRollup: [checkOk, dockerOk, testsOk] };

describe("blockers", () => {
  it("allows a ready, mergeable PR with all required checks green", () => {
    expect(blockers(green)).toEqual([]);
  });

  it("refuses a draft or unmergeable PR", () => {
    expect(blockers({ ...green, isDraft: true })).toEqual(["PR is a draft"]);
    expect(blockers({ ...green, mergeable: "CONFLICTING" })).toEqual(["mergeable is CONFLICTING"]);
  });

  it("refuses while a check is pending", () => {
    const pr = { ...green, statusCheckRollup: [run("check", "IN_PROGRESS", null), dockerOk, testsOk] };
    expect(blockers(pr)).toEqual(["check check is pending"]);
  });

  it("refuses a skipped required check", () => {
    const pr = { ...green, statusCheckRollup: [checkOk, dockerOk, run("tests-required", "COMPLETED", "SKIPPED")] };
    expect(blockers(pr)).toEqual(["check tests-required concluded SKIPPED"]);
  });

  it("refuses when a required check never ran on the head", () => {
    expect(blockers({ ...green, statusCheckRollup: [checkOk] })).toEqual([
      "required check docker has not run on the head commit",
      "required check tests-required has not run on the head commit",
    ]);
  });

  it("refuses any failing check", () => {
    const failing = { __typename: "StatusContext", context: "x", state: "FAILURE" };
    expect(blockers({ ...green, statusCheckRollup: [checkOk, dockerOk, testsOk, failing] })).toEqual([
      "check x concluded FAILURE",
    ]);
  });
});
