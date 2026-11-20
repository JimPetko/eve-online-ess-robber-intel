# Calibrating the Bounty Assumptions

Researched 2026-11-18. Confidence: high = CCP primary source or CCP data, medium = CCP-adjacent or consistent player sources, low = a single player claim or an inference.

The Bounty Assumptions turn ESI `npc_kills` into ISK. This note records where each figure comes from and how `scripts/calibrate-bounties.mjs` derives ISK per NPC kill. It supersedes the share and ISK-per-kill guesses in [reserve-bank.md](reserve-bank.md).

## Data used

- CCP Monthly Economic Report (MER) for October 2026: `https://web.ccpgamescdn.com/aws/community/EVEOnline_MER_202610.zip`.
  - `data/key_economic_figures_by_region.csv`, column `npc_bounties` per Region.
  - `data/sinks_and_faucets_history.csv`, daily faucets "Bounty Prizes" and "ESS Main Bank Autopayment", 2023-10 to 2026-10.
  - `data/static_solarsystems.csv`, each System's Region and metagroup (`Null Sec (Sov)`, `Null Sec (NPC)`, and so on).
- EVE Ref's hourly archive of ESI `/universe/system_kills/`: `https://data.everef.net/system-kills/history/`. The current year is one `.json.bz2` per hour under per-day folders. Earlier years are one `.tar.xz` of plain `.json` files per year, back to 2017 (2020 is missing). October 2026 has 682 of its 744 hourly snapshots.

## CCP changes that bear on the ESS

| Date | Patch | Change | Source |
|---|---|---|---|
| 2020-10 | Dynamic Frontiers devblog | An ESS in "every sovereign nullsec system, excluding NPC-held ones". The ESS percentage "is fixed and takes effect after the Dynamic Bounties System calculation is applied". | [devblog](https://www.eveonline.com/news/view/dynamic-frontiers-update) |
| 2020-10-30 | ESS Update devblog | The Main Bank gets "the majority", the Reserve "a smaller portion of each bounty". No percentages. | [devblog](https://www.eveonline.com/news/view/encounter-surveillance-system-update) |
| 2020-11-10 | 18.11 | ESS mandatory "in all claimable Null Security Space". Main Bank pays every 3h. | [notes](https://www.eveonline.com/news/view/patch-notes-for-version-18-11) |
| 2020-12-01 | 18.11 | Autopay 3h to 2h. DBS equilibrium 115% to 135%, max 150% to 180%. | same |
| 2021-04-13 | 19.03 | **Autopay 2h to 2h45m.** DBS equilibrium 135% to 150%, max 180% to 200%. | [notes](https://www.eveonline.com/news/view/patch-notes-version-19-03) |
| 2021-10-13 | 19.09 | DBS thresholds adjusted. Fixed ESSs "appear[ing] outside of intended systems". | [notes](https://www.eveonline.com/news/view/patch-notes-version-19-09) |
| 2022-02-08 | 20.02 | DBS floor 30% to 50%. At the minimum modifier, systems "produce 100% of bounties with 50% of each bounty entering the ESS Bank". Max Reserve payout +33.3%. | [notes](https://www.eveonline.com/news/view/patch-notes-version-20-02) |
| 2022-10-25 | 20.09 | "The minimum output of the DBM is increased to 100% from 50%" (110% temporarily). DBS thresholds reduced, "more reactive". | [notes](https://www.eveonline.com/news/view/patch-notes-version-20-09) |
| 2024-11 / 2025-03 | 22.02 | Nullsec anomaly bounties +30-40%, then rolled back to "slightly above their original values" except Forsaken Sanctum and Teeming Horde (about +36%). | [notes](https://www.eveonline.com/news/view/patch-notes-version-22-02) |

No CCP source states the Main or Reserve percentage. Searches of 22.01 (Equinox) through 24.02 found no further DBS or ESS share change. The MER agrees: ESS Main Bank Autopayment ÷ Bounty Prizes stays between 0.46 and 0.55 every month from 2023-10 to 2026-10, with no step.

### The 20.02 "50%"

The sentence describes only Systems at the DBS floor. Before 20.02 a floor System paid 30% directly and funnelled 28.2% into the ESS, and the rest of the bounty was destroyed ("58.2%"). From 20.02 the lost part went to the ESS instead (50% direct + 50% ESS). Since 20.09 raised the floor to 100%, the case no longer arises. It is not the normal split. Earlier repo docs called this patch 22.02; it is 20.02, released 2022-02-08.

## What `npc_bounties` measures

- Regional `npc_bounties` sums to 86.8T ISK for October 2026. Bounty Prizes (59.6T) plus ESS Main Bank Autopayment (30.7T) is 90.3T. So `npc_bounties` is the post-DBS bounty value *including* the Main Bank share, within about 4%, not just direct payouts.
- Subtracting the hisec, lowsec and NPC-null bounty leaves about 75.9T in sov-null Regions. Direct payouts there come to about 48.7T, so the 75.9T leaves no room for a Reserve share: `npc_bounties` appears to exclude it (inference).

## Main Bank share: 0.40

Main Bank autopay ÷ sov-null `npc_bounties` ≈ 30.7 / 75.9 ≈ 0.40, or 30.7 / (48.7 + 30.7) ≈ 0.39. Autopay misses banks that were robbed, so the share generated is at least that. This rules out the 0.35 player figure, which would give at most 0.37 even with no Robberies, and matches the EVE University wiki's "40% of the bounties". So the 0.40 is a share of `npc_bounties`, the same base as ISK per kill, and the Main Bank Ceiling applies it to ISK per kill directly. Confidence medium-high.

## The DBS needs no factor

The ESS cut is taken after the DBS multiplier (Dynamic Frontiers). Today's range is 100% to 200% (20.09, 19.03), and the modifier is not in ESI. Because ISK per kill is calibrated from bounties CCP actually paid, the multiplier is already inside it. Multiplying again would double-count it.

## ISK per NPC kill

ISK per kill for a Region = its `npc_bounties` ÷ the `npc_kills` EVE Ref archived for its Systems that month, with kills scaled by hours in the month ÷ hours sampled. Dividing by every ESI kill also absorbs NPCs that pay no bounty. October 2026, Regions with at least 90% of their kills in sov nullsec:

| Region | ISK per kill | NPC kills (M) |
|---|---|---|
| Insmother | 462k | 10.4 |
| Wicked Creek | 414k | 3.6 |
| Scalding Pass | 409k | 3.2 |
| Omist | 400k | 3.2 |
| Feythabolis | 387k | 9.6 |
| Immensea | 387k | 8.2 |
| Paragon Soul | 383k | 7.9 |
| Cloud Ring | 380k | 1.1 |
| Impass | 379k | 2.5 |
| Esoteria | 377k | 13.5 |
| Period Basis | 375k | 10.4 |
| Cache | 374k | 3.6 |
| Detorid | 369k | 8.9 |
| Tenerifis | 353k | 8.3 |
| Fade | 350k | 3.1 |
| Branch | 344k | 13.0 |
| Fountain | 338k | 19.3 |
| Deklein | 335k | 7.0 |
| Tenal | 331k | 13.7 |
| Vale of the Silent | 330k | 24.7 |
| Tribute | 318k | 11.7 |
| Catch | 316k | 5.5 |
| Delve | 313k | 7.8 |
| Querious | 312k | 4.9 |
| Geminate | 300k | 2.9 |
| Oasa | 299k | 1.5 |
| Providence | 261k | 2.0 |
| Cobalt Edge | 223k | 1.1 |
| The Kalevala Expanse | 213k | 0.5 |
| Perrigen Falls | 209k | 6.0 |
| Outer Passage | 206k | 1.2 |
| The Spire | 202k | 2.7 |
| Malpais | 186k | 0.9 |
| Etherium Reach | 185k | 0.9 |

- Pooled over these 34 Regions: **346k ISK per kill**, the fallback for every other Region. Pure Blind (89.6% sov) is the only Region with sov nullsec on the fallback.
- The old guesses (0.5M to 1.2M by true security) overestimated by 1.4× to 3.5× against the pooled figure.

### Why not by true security

A non-negative least-squares fit of the same data by true-security band (0.0 to -0.2 and so on in steps of 0.2; kills of 24M, 39M, 44M, 52M and 35M per band, shallowest first) gives 340k, 225k, 465k, 333k and 408k. It is not monotonic, because the bands are collinear across Regions. Region identity, which carries the site mix, Upwell structures and how hard the DBS is farmed, explains more than depth does. So the tool prices kills per Region, not by depth.

### Caveats

- One month. The Bounty Prizes faucet in October 2026 was about 30% above 2025, so recalibrate monthly.
- Missing hours are assumed average when kills are scaled up.
- The figures are Region averages. A single System at the DBS floor or at 200% differs more. Confidence medium-high per Region, low for any one System-hour.
- MER `Null Sec (Sov)` means claimable, not held, so unclaimed Systems in a Region count toward its kills and its bounties.

## Reserve fill share: 0.05 to 0.10

CCP says only "a smaller portion" of each bounty (18.11) and "a small part" (Grand Heist). The one player figure is a 35/5 Main/Reserve split ([forum](https://forums.eveonline.com/t/ess-payout/332417)). The old 0.20 upper bound assumed a 40% ESS cut split equally between the banks ([forum](https://forums.eveonline.com/t/brm-ess-isk-payouts/361667)). The MER shows the Main Bank alone takes about 0.40, which rules that split out. The band is now 0.05 to 0.10, the high end left at twice the only figure. Confidence low. The MER cannot measure it, because `npc_bounties` excludes the Reserve share.

The fill share r is a share of the gross bounty. ISK per kill, calibrated from `npc_bounties`, covers only the other (1 − r) of it, so Reserve accrual is kills × ISK per kill × r / (1 − r): 5.26% of the net figure at r = 0.05 and 11.11% at r = 0.10.

## Robber Take: 0.80

The EVE University wiki says a Robber gets "about four-fifths" of the Main Bank. At launch in November 2020 the ESS window showed "70% convertable" ([TAGN](https://wilhelm2451.blogspot.com/search/label/Merkelchen)). No patch note records the change. Confidence medium.

## Payout Cycle: 2h45m

19.03 (2021-04-13): "autopay timer for the Main Bank increased from 2h to 2h:45m". No later change found. Confidence high. No source says whether the countdown runs per System or on a server clock, and player wording ("whatever is left on the timer") suggests per System. The tool assumes an independent phase per System.

## Unclaimed sov nullsec has no ESS

The tool keeps alliance-held sov nullsec only, which is the operator's first-hand account. The evidence is inconclusive either way:

- No CCP text says an ESS spawns in, or is removed from, a System without a sov claim. The Equinox expansion notes never mention the ESS.
- The wording varies. Dynamic Frontiers says "every *sovereign* nullsec system", 18.11 says "all claimable Null Security Space", and the EVE University wiki says "Every *sovereign* nullsec solar system". "Sovereign" reads more naturally as held.
- 19.09 fixed ESSs "appear[ing] outside of intended systems", so the spawn rule is narrower than every nullsec System, but the note does not say how.
- No player report of an ESS in an unclaimed System was found.
- NPC nullsec has none (high confidence), though the DBS still applies there.

## Recalibrating

Run `node scripts/calibrate-bounties.mjs <YYYY-MM>` once CCP publishes that month's MER (October 2026's appeared on 2026-11-09). It downloads the MER zip and EVE Ref's kills for the month, rewrites `src/domain/isk-per-npc-kill.generated.ts`, and prints the table and the Regions left on the fallback. Commit the generated file. A Region is calibrated when it logged at least 100,000 NPC kills that month, at least 90% of them in sov nullsec.
