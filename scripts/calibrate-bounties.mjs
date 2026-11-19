#!/usr/bin/env node
// Calibrates ISK per NPC kill per Region for one month and writes
// src/domain/isk-per-npc-kill.generated.ts. Usage: node scripts/calibrate-bounties.mjs <YYYY-MM>
//
// ISK per kill = the Region's `npc_bounties` in CCP's Monthly Economic Report
// ÷ the ESI `npc_kills` EVE Ref archived for its Systems that month. Bounties
// are post-DBS and include the ESS Main Bank share, so neither needs modelling.
// Method and evidence: docs/research/bounty-calibration.md.
import { writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import Bunzip from "seek-bzip";
import xz from "xz-decompress";
import { loadConfig } from "../src/server/config.ts";

/** A Region is calibrated when at least this share of its kills are in sov nullsec. */
export const MIN_SOV_KILL_SHARE = 0.9;
/** ...and it logged at least this many NPC kills in the month. */
export const MIN_NPC_KILLS = 100_000;

const OUT = new URL("../src/domain/isk-per-npc-kill.generated.ts", import.meta.url);
const SOV_NULL = "Null Sec (Sov)";

/** RFC 4180 CSV with a header row, to an array of objects keyed by header. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field !== "" || row.length > 0) row.push(field), rows.push(row);
  const [header = [], ...body] = rows;
  return body.filter((r) => r.length > 1 || r[0] !== "").map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

export function hoursInMonth(month) {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate() * 24;
}

/**
 * Sums `npc_kills` per System over EVE Ref snapshots named
 * `system-kills-YYYY-MM-DD_HH-MM-SS.json[.bz2]`, keeping the first snapshot of
 * each hour in `month` and ignoring the rest.
 */
export class KillTally {
  bySystem = new Map();
  hours = new Set();

  constructor(month) {
    this.month = month;
  }

  /** The snapshot's hour, or null when it is outside the month or a repeat. */
  wants(fileName) {
    const hour = /system-kills-(\d{4}-\d{2})-(\d{2})_(\d{2})/.exec(fileName);
    if (hour === null || hour[1] !== this.month) return null;
    const key = `${hour[1]}-${hour[2]}T${hour[3]}`;
    return this.hours.has(key) ? null : key;
  }

  add(fileName, entries) {
    const hour = this.wants(fileName);
    if (hour === null) return;
    this.hours.add(hour);
    for (const { system_id, npc_kills } of entries)
      this.bySystem.set(system_id, (this.bySystem.get(system_id) ?? 0) + npc_kills);
  }
}

/**
 * Per-Region ISK per NPC kill. Kills are scaled up to the whole month to
 * match the monthly bounty total, which assumes missing hours were average.
 * The fallback pools every calibrated Region.
 */
export function calibrate({ month, regionsCsv, systemsCsv, tally }) {
  const totalHours = hoursInMonth(month);
  const hoursSampled = tally.hours.size;
  if (hoursSampled === 0) throw new Error(`no EVE Ref kill snapshots for ${month}`);
  const scale = totalHours / hoursSampled;

  const regions = new Map();
  const regionOf = new Map();
  for (const s of parseCsv(systemsCsv)) {
    const sov = s.solarsystem_metagroup === SOV_NULL;
    regionOf.set(Number(s.solarsystem_id), { name: s.region_name, sov });
    const region = regions.get(s.region_name) ?? { regionId: Number(s.region_id), name: s.region_name, hasSov: false, kills: 0, sovKills: 0 };
    region.hasSov ||= sov;
    regions.set(s.region_name, region);
  }
  for (const [systemId, kills] of tally.bySystem) {
    const system = regionOf.get(systemId);
    if (system === undefined) continue;
    const region = regions.get(system.name);
    region.kills += kills * scale;
    if (system.sov) region.sovKills += kills * scale;
  }
  const bountiesOf = new Map(parseCsv(regionsCsv).map((r) => [r.region_name, Number(r.npc_bounties)]));

  const calibrated = [];
  const uncalibrated = [];
  for (const region of regions.values()) {
    if (!region.hasSov) continue;
    const bounties = bountiesOf.get(region.name) ?? 0;
    const npcKills = Math.round(region.kills);
    const sovKillShare = region.kills > 0 ? Math.round((region.sovKills / region.kills) * 1000) / 1000 : 0;
    const row = { regionId: region.regionId, name: region.name, npcKills, sovKillShare };
    if (npcKills >= MIN_NPC_KILLS && sovKillShare >= MIN_SOV_KILL_SHARE && bounties > 0)
      calibrated.push({ ...row, iskPerNpcKill: Math.round(bounties / region.kills), bounties });
    else uncalibrated.push(row);
  }
  if (calibrated.length === 0) throw new Error(`no Region in ${month} qualifies for calibration`);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const pooledBounties = calibrated.reduce((sum, r) => sum + r.bounties, 0);
  const pooledKills = calibrated.reduce((sum, r) => sum + r.npcKills, 0);
  return {
    month,
    hoursSampled,
    hoursInMonth: totalHours,
    fallback: Math.round(pooledBounties / pooledKills),
    regions: calibrated.sort(byName).map(({ regionId, name, iskPerNpcKill, npcKills, sovKillShare }) => ({
      regionId,
      name,
      iskPerNpcKill,
      npcKills,
      sovKillShare,
    })),
    /** Regions with sov nullsec that fall back, with why. */
    uncalibrated: uncalibrated.sort(byName),
  };
}

export function renderModule({ month, hoursSampled, hoursInMonth, fallback, regions }) {
  const rows = regions.map(
    (r) =>
      `    { regionId: ${String(r.regionId)}, name: ${JSON.stringify(r.name)}, iskPerNpcKill: ${String(r.iskPerNpcKill)}, npcKills: ${String(r.npcKills)}, sovKillShare: ${String(r.sovKillShare)} },`,
  );
  return `// Generated by \`node scripts/calibrate-bounties.mjs ${month}\`. Do not edit by hand.
// ISK of NPC bounty (post-DBS, including the ESS share) per ESI NPC kill:
// CCP Monthly Economic Report npc_bounties ÷ EVE Ref hourly ESI npc_kills.
// See docs/research/bounty-calibration.md.
export const ISK_PER_NPC_KILL_CALIBRATION = {
  month: "${month}",
  /** Hourly kill snapshots found; kills are scaled up by hoursInMonth / hoursSampled. */
  hoursSampled: ${String(hoursSampled)},
  hoursInMonth: ${String(hoursInMonth)},
  /** A Region is listed with at least ${String(MIN_NPC_KILLS)} kills, ${String(MIN_SOV_KILL_SHARE * 100)}% of them in sov nullsec. */
  minNpcKills: ${String(MIN_NPC_KILLS)},
  minSovKillShare: ${String(MIN_SOV_KILL_SHARE)},
  /** Pooled over every listed Region; used for any other Region. */
  fallback: ${String(fallback)},
  regions: [
${rows.join("\n")}
  ],
};
`;
}

// ---- IO: everything below touches the network.

async function get(url, userAgent) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`GET ${url}: ${String(res.status)}`);
  return res;
}

/** Reads named entries from a zip held in memory (stored or deflated, no zip64). */
function unzip(zip, wanted) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const out = new Map();
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    const local = zip.readUInt32LE(p + 42);
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    const key = wanted.find((w) => name.endsWith(w));
    if (key === undefined) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    out.set(key, (method === 0 ? data : inflateRawSync(data)).toString("utf8"));
  }
  for (const w of wanted) if (!out.has(w)) throw new Error(`zip has no ${w}`);
  return out;
}

async function merCsvs(month, userAgent) {
  const url = `https://web.ccpgamescdn.com/aws/community/EVEOnline_MER_${month.replace("-", "")}.zip`;
  const zip = Buffer.from(await (await get(url, userAgent)).arrayBuffer());
  const files = unzip(zip, ["data/key_economic_figures_by_region.csv", "data/static_solarsystems.csv"]);
  return {
    regionsCsv: files.get("data/key_economic_figures_by_region.csv"),
    systemsCsv: files.get("data/static_solarsystems.csv"),
  };
}

const EVEREF = "https://data.everef.net/system-kills/history";

/** The current year is kept as one .json.bz2 per hour under per-day directories. */
async function tallyDaily(tally, userAgent) {
  const year = tally.month.slice(0, 4);
  const res = await fetch(`${EVEREF}/${year}/index.json`, { headers: { "User-Agent": userAgent } });
  if (!res.ok) return false;
  const days = (await res.json()).directories.filter((d) => d.name.startsWith(tally.month));
  if (days.length === 0) return false;
  const files = [];
  for (const day of days) files.push(...(await (await get(day.index_url, userAgent)).json()).files);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      if (tally.wants(file.name) === null) continue;
      const bz2 = Buffer.from(await (await get(file.url, userAgent)).arrayBuffer());
      tally.add(file.name, JSON.parse(Bunzip.decode(bz2).toString("utf8")));
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return true;
}

/** Earlier years are rolled up into one .tar.xz of plain .json files, streamed here. */
async function tallyRollup(tally, userAgent) {
  const res = await get(`${EVEREF}/system-kills-${tally.month.slice(0, 4)}.tar.xz`, userAgent);
  const tar = Readable.fromWeb(new xz.XzReadableStream(res.body));
  let buffered = Buffer.alloc(0);
  let entry = null; // { name, size, skip }
  for await (const chunk of tar) {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (entry === null) {
        if (buffered.length < 512) break;
        const header = buffered.subarray(0, 512);
        buffered = buffered.subarray(512);
        if (header.every((b) => b === 0)) continue;
        const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "");
        const size = parseInt(header.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
        entry = { name, size, padded: Math.ceil(size / 512) * 512 };
      }
      if (buffered.length < entry.padded) break;
      if (entry.name.endsWith(".json") && tally.wants(entry.name) !== null)
        tally.add(entry.name, JSON.parse(buffered.toString("utf8", 0, entry.size)));
      buffered = buffered.subarray(entry.padded);
      entry = null;
    }
  }
}

async function main([month]) {
  if (month === undefined || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    console.error("usage: node scripts/calibrate-bounties.mjs <YYYY-MM>");
    return 2;
  }
  const { userAgent } = loadConfig();
  const tally = new KillTally(month);
  const [csvs] = await Promise.all([
    merCsvs(month, userAgent),
    tallyDaily(tally, userAgent).then((found) => found || tallyRollup(tally, userAgent)),
  ]);
  const calibration = calibrate({ month, ...csvs, tally });
  writeFileSync(OUT, renderModule(calibration));
  console.log(`${month}: ${String(calibration.hoursSampled)}/${String(calibration.hoursInMonth)} hours sampled`);
  console.table(calibration.regions);
  console.log(`fallback (pooled): ${String(calibration.fallback)} ISK per NPC kill`);
  if (calibration.uncalibrated.length > 0) {
    console.log("Regions with sov nullsec on the fallback:");
    console.table(calibration.uncalibrated);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await main(process.argv.slice(2)));
