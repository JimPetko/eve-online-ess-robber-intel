import { describe, expect, it } from "vitest";
import { calibrate, KillTally, merFileKey, renderModule, tarFiles } from "./calibrate-bounties.mjs";

const systemsCsv = `solarsystem_id,solarsystem_name,solarsystem_metagroup,region_id,region_name
101,A-1,Null Sec (Sov),1,Alpha
102,A-2,Null Sec (Sov),1,Alpha
501,B-1,Null Sec (Sov),5,Beta
201,M-1,Null Sec (Sov),2,Mixed
202,M-2,Null Sec (NPC),2,Mixed
301,T-1,Null Sec (Sov),3,Tiny
401,H-1,High Sec,4,"High, Sec"
`;

// February 2026 has 672 hours; the tally below samples 2, so kills scale by 336.
const regionsCsv = `region_name,destroyed_value,npc_bounties
Alpha,0,58800000000
Beta,0,67200000000
Mixed,0,10000000000
Tiny,0,1000000000
"High, Sec",0,5000000000
`;

function tally() {
  const t = new KillTally("2026-02");
  const hour1 = [
    { system_id: 101, npc_kills: 300 },
    { system_id: 102, npc_kills: 100 },
    { system_id: 501, npc_kills: 1000 },
    { system_id: 201, npc_kills: 300 },
    { system_id: 202, npc_kills: 100 },
    { system_id: 301, npc_kills: 10 },
    { system_id: 401, npc_kills: 5000 },
  ];
  t.add("system-kills/history/2026/2026-02-01/system-kills-2026-02-01_00-44-05.json", hour1);
  // A second snapshot in the same hour and one from another month are ignored.
  t.add("system-kills-2026-02-01_00-59-00.json.bz2", hour1);
  t.add("system-kills-2026-03-01_00-44-05.json.bz2", hour1);
  t.add("system-kills-2026-02-01_01-44-05.json.bz2", [{ system_id: 101, npc_kills: 100 }]);
  return t;
}

describe("calibrate", () => {
  const result = calibrate({ month: "2026-02", regionsCsv, systemsCsv, tally: tally() });

  it("divides each sov Region's bounties by its kills scaled to the whole month", () => {
    expect(result).toMatchObject({ month: "2026-02", hoursSampled: 2, hoursInMonth: 672 });
    expect(result.regions).toEqual([
      { regionId: 1, name: "Alpha", iskPerNpcKill: 350_000, npcKills: 168_000, sovKillShare: 1 },
      { regionId: 5, name: "Beta", iskPerNpcKill: 200_000, npcKills: 336_000, sovKillShare: 1 },
    ]);
  });

  it("pools the calibrated Regions into the fallback", () => {
    expect(result.fallback).toBe(250_000); // 126B ISK / 504k kills
  });

  it("leaves mixed and thinly ratted Regions on the fallback, and ignores Regions without sov", () => {
    expect(result.uncalibrated).toEqual([
      { regionId: 2, name: "Mixed", npcKills: 134_400, sovKillShare: 0.75 },
      { regionId: 3, name: "Tiny", npcKills: 3_360, sovKillShare: 1 },
    ]);
  });

  it("refuses a month with no snapshots", () => {
    expect(() => calibrate({ month: "2026-02", regionsCsv, systemsCsv, tally: new KillTally("2026-02") })).toThrow(
      "no EVE Ref kill snapshots for 2026-02",
    );
  });
});

describe("renderModule", () => {
  it("writes the month, coverage, fallback and one line per Region", () => {
    const source = renderModule(calibrate({ month: "2026-02", regionsCsv, systemsCsv, tally: tally() }));
    expect(source).toContain('month: "2026-02",');
    expect(source).toContain("hoursSampled: 2,");
    expect(source).toContain("fallback: 250000,");
    expect(source).toContain(
      '{ regionId: 1, name: "Alpha", iskPerNpcKill: 350000, npcKills: 168000, sovKillShare: 1 },',
    );
  });
});

describe("tarFiles", () => {
  const USTAR = "ustar\u000000";
  const GNU = "ustar  \u0000";

  /** One tar entry: a 512-byte header plus its body padded to 512. */
  function entry({ name, type = "0", prefix = "", magic = USTAR }, body = "") {
    const header = Buffer.alloc(512);
    const bytes = Buffer.from(body, "utf8");
    header.write(name, 0, 100, "utf8");
    header.write(bytes.length.toString(8).padStart(11, "0"), 124, "ascii");
    header.write(type, 156, "latin1");
    header.write(magic, 257, "latin1");
    header.write(prefix, 345, 155, "utf8");
    return Buffer.concat([header, bytes, Buffer.alloc(Math.ceil(bytes.length / 512) * 512 - bytes.length)]);
  }

  /** A pax record, whose length field counts its own digits. */
  function paxRecord(key, value) {
    const rest = ` ${key}=${value}\n`;
    let len = rest.length;
    while (String(len).length + rest.length !== len) len = String(len).length + rest.length;
    return `${String(len)}${rest}`;
  }

  async function files(tar, chunkSize = 100) {
    const chunks = [];
    for (let i = 0; i < tar.length; i += chunkSize) chunks.push(tar.subarray(i, i + chunkSize));
    const out = [];
    for await (const { name, body } of tarFiles(chunks)) out.push([name, body.toString("utf8")]);
    return out;
  }

  const dir = `system-kills/history/2025/${"d".repeat(120)}`;
  const longName = `${dir}/system-kills-2025-10-01_00-44-05.json`;
  const end = Buffer.alloc(1024);

  it("applies a pax path to the next file and skips the pax headers themselves", async () => {
    const tar = Buffer.concat([
      entry({ name: "./PaxHeaders/global.json", type: "g" }, paxRecord("comment", "x")),
      entry({ name: "./PaxHeaders/system-kills.json", type: "x" }, paxRecord("mtime", "1") + paxRecord("path", longName)),
      entry({ name: longName.slice(0, 100) }, "[1]"),
      entry({ name: "short.json" }, "[2]"),
      end,
    ]);
    expect(await files(tar)).toEqual([
      [longName, "[1]"],
      ["short.json", "[2]"],
    ]);
  });

  it("applies a GNU long name to the next file", async () => {
    const tar = Buffer.concat([
      entry({ name: "././@LongLink", type: "L", magic: GNU }, `${longName}\u0000`),
      entry({ name: longName.slice(0, 100), magic: GNU }, "[1]"),
      end,
    ]);
    expect(await files(tar)).toEqual([[longName, "[1]"]]);
  });

  it("joins the ustar prefix and skips directories", async () => {
    const tar = Buffer.concat([
      entry({ name: "", prefix: dir, type: "5" }),
      entry({ name: "system-kills-2025-10-01_00-44-05.json", prefix: dir }, "[1]"),
      end,
    ]);
    expect(await files(tar, 512 * 3)).toEqual([[longName, "[1]"]]);
  });
});

describe("merFileKey", () => {
  const wanted = ["data/key_economic_figures_by_region.csv", "data/static_solarsystems.csv"];

  it("finds tables under their current and older numbered names", () => {
    expect(merFileKey("data/key_economic_figures_by_region.csv", wanted)).toBe(wanted[0]);
    expect(merFileKey("data/1_key_economic_figures_by_region.csv", wanted)).toBe(wanted[0]);
    expect(merFileKey("EVEOnline_MER_202510/data/12_static_solarsystems.csv", wanted)).toBe(wanted[1]);
  });

  it("ignores other tables", () => {
    expect(merFileKey("data/2_sinks_and_faucets_history.csv", wanted)).toBeUndefined();
    expect(merFileKey("data/x_key_economic_figures_by_region.csv", wanted)).toBeUndefined();
  });
});
