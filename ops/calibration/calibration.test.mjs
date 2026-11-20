import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderModule } from "../../scripts/calibrate-bounties.mjs";
import { calibrationSummary, checksState, commitMessage, merNotPublished, prBody, prState, targetMonth } from "./calibration.mjs";

const generated = (month) =>
  renderModule({
    month,
    hoursSampled: 700,
    hoursInMonth: 720,
    fallback: 351234,
    regions: [{ regionId: 10000060, name: "Delve", iskPerNpcKill: 312864, npcKills: 7818012, sovKillShare: 0.92 }],
  });

describe("targetMonth", () => {
  it("is the previous calendar month", () => {
    expect(targetMonth(new Date("2026-11-19T15:00:00Z"))).toBe("2026-10");
  });

  it("is December of the previous year in January", () => {
    expect(targetMonth(new Date("2027-01-05T15:00:00Z"))).toBe("2026-12");
  });

  it("uses UTC, not local time, at a month boundary", () => {
    expect(targetMonth(new Date("2026-12-01T00:30:00Z"))).toBe("2026-11");
    expect(targetMonth(new Date("2026-11-30T23:30:00Z"))).toBe("2026-10");
  });

  it("handles a 31st that has no counterpart in the previous month", () => {
    expect(targetMonth(new Date("2026-03-31T12:00:00Z"))).toBe("2026-02");
  });
});

describe("calibrationSummary", () => {
  it("reads the figures from what calibrate-bounties writes", () => {
    expect(calibrationSummary(generated("2026-11"))).toEqual({
      month: "2026-11",
      fallback: 351234,
      hoursSampled: 700,
      hoursInMonth: 720,
    });
  });

  it("reads the checked-in generated file", () => {
    const source = readFileSync(new URL("../../src/domain/isk-per-npc-kill.generated.ts", import.meta.url), "utf8");
    expect(calibrationSummary(source)?.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("is null for a file with no calibration", () => {
    expect(calibrationSummary("export const X = 1;\n")).toBeNull();
  });
});

describe("merNotPublished", () => {
  it("recognises a 404 on the MER zip", () => {
    expect(merNotPublished("Error: GET https://web.ccpgamescdn.com/aws/community/EVEOnline_MER_202611.zip: 404\n    at get")).toBe(true);
  });

  it("treats any other failure as a real failure", () => {
    expect(merNotPublished("Error: GET https://web.ccpgamescdn.com/aws/community/EVEOnline_MER_202611.zip: 503")).toBe(false);
    expect(merNotPublished("Error: GET https://data.everef.net/system-kills/history/2026/index.json: 404")).toBe(false);
    expect(merNotPublished("Error: no EVE Ref kill snapshots for 2026-11")).toBe(false);
  });
});

describe("prState", () => {
  it("prefers a merged PR, then an open one, ignoring closed ones", () => {
    expect(
      prState([
        { number: 3, state: "OPEN", url: "u3" },
        { number: 2, state: "MERGED", url: "u2" },
      ]),
    ).toEqual({ state: "MERGED", url: "u2" });
    expect(prState([{ number: 4, state: "CLOSED", url: "u4" }, { number: 5, state: "OPEN", url: "u5" }])).toEqual({
      state: "OPEN",
      url: "u5",
    });
    expect(prState([{ number: 4, state: "CLOSED", url: "u4" }])).toEqual({ state: "NONE" });
  });
});

describe("checksState", () => {
  const run = (name, status, conclusion = "") => ({ __typename: "CheckRun", name, status, conclusion });

  it("is pending until both required checks have run", () => {
    expect(checksState({ statusCheckRollup: [] })).toBe("pending");
    expect(checksState({ statusCheckRollup: [run("check", "COMPLETED", "SUCCESS")] })).toBe("pending");
    expect(checksState({ statusCheckRollup: [run("check", "COMPLETED", "SUCCESS"), run("tests-required", "IN_PROGRESS")] })).toBe(
      "pending",
    );
  });

  it("passes when every check succeeded", () => {
    expect(
      checksState({ statusCheckRollup: [run("check", "COMPLETED", "SUCCESS"), run("tests-required", "COMPLETED", "SUCCESS")] }),
    ).toBe("passed");
  });

  it("fails as soon as any check fails, even while others run", () => {
    expect(checksState({ statusCheckRollup: [run("check", "COMPLETED", "FAILURE"), run("tests-required", "QUEUED")] })).toBe(
      "failed",
    );
    expect(
      checksState({
        statusCheckRollup: [
          run("check", "COMPLETED", "SUCCESS"),
          run("tests-required", "COMPLETED", "SUCCESS"),
          { __typename: "StatusContext", context: "external", state: "ERROR" },
        ],
      }),
    ).toBe("failed");
  });
});

describe("commit message and PR body", () => {
  const after = { month: "2026-11", fallback: 351234, hoursSampled: 700, hoursInMonth: 720 };

  it("names the month and lists the fallback and hours sampled", () => {
    expect(commitMessage(after)).toBe(
      "chore(calibration): recalibrate ISK per NPC kill for 2026-11\n\nFallback (pooled): 351234 ISK per NPC kill.\nHours sampled: 700/720.\n",
    );
  });

  it("explains the change, the waiver and links the method", () => {
    const body = prBody({ repo: "o/r", after, before: { month: "2026-10", fallback: 346088, hoursSampled: 682, hoursInMonth: 744 } });
    expect(body).toContain("Fallback (pooled): 351234 ISK per NPC kill (was 346088 for 2026-10).");
    expect(body).toContain("Hours sampled: 700/720.");
    expect(body).toContain("https://github.com/o/r/blob/main/docs/research/bounty-calibration.md");
    expect(body).toContain("`no-tests-needed`: the change is generated data");
  });
});

describe("CLI", () => {
  const cli = (args, input) =>
    execFileSync(process.execPath, [fileURLToPath(new URL("./calibration.mjs", import.meta.url)), ...args], {
      input,
      encoding: "utf8",
    });

  it("prints the calibrated month of a generated file on stdin", () => {
    expect(cli(["calibrated-month"], generated("2026-11"))).toBe("2026-11\n");
    expect(cli(["calibrated-month"], "nothing here")).toBe("\n");
  });

  it("prints the PR state and URL", () => {
    expect(cli(["pr-state"], JSON.stringify([{ number: 1, state: "MERGED", url: "https://x/pull/1" }]))).toBe(
      "MERGED https://x/pull/1\n",
    );
    expect(cli(["pr-state"], "[]")).toBe("NONE\n");
  });
});
