# ESS Reserve Bank: how the balance is determined

Researched 2026-11-18. Confidence: H = CCP primary source, M = CCP-adjacent or consistent player sources, L = single player claim or speculation.
Not retrieved or verified: the Oct 2020 DBS devblog itself, full MER contents (search snippets only), 2026 patch notes, any ESI behaviour for ESS.

## Decision 2026-11-19: cut the Reserve Bank Estimate

The provisional estimate (a 30-day floor on accrual, kills × ISK per kill × r / (1 − r), r = 0.05–0.10) is removed from the API and UI. It answered a question no Robber acts on:

- **Payout ignores the balance.** A key pays on a fixed per-minute curve that ramps to a peak and falls until the 15 or 45 minutes run out. CCP_Psych, Grand Heist test thread (16 Jul 2021): "expect a max payout per tick of around 150mil", with no reference to bank size. Players confirm it "doesn't scale with the amount of isk in the bank" (about 35M taken from a 17B bank), and in Feb 2022 a proposal to scale it was never shipped ([test thread p2](https://forums.eveonline.com/t/the-grand-heist-in-testing/320160?page=2), [p6](https://forums.eveonline.com/t/the-grand-heist-in-testing/320160?page=6), [Olmeca Gold](https://forums.eveonline.com/t/ess-reserve-bank-an-underwhelming-design-and-what-it-could-have-been/349355)) (M, close to H).
- **The balance is never the limit in practice.** Reserves held about 20T at launch ([Grand Heist](https://eveonline.com/news/view/the-grand-heist)) (H). Reported banks run 17–48B or more, and a key drains at most a few billion. No report of an emptied reserve was found (M).
- **Our own data agrees.** On 2026-11-19, with 8 hours of history, the busiest System showed 0.30–0.63B. Over 30 days that scales to roughly 25–50B, far above any key's take, so the band could only ever say "more than a key can drain".
- **Players choose by key quadrant, travel and risk**, not balance. A reserve heist is a planned group activity started with a lowsec key that alerts the whole Region; Main Bank robbing is opportunistic. The in-space ESS UI shows both banks, and players quote reserve sizes, so they likely see the true figure in game (L for the Agency window).
- **No change since 2022 was found** to key payouts. The 2024 and Legion (2025) changes touch only the Main Bank room; Fractured Skies (Nov 2026) does not mention the ESS (M; Equinox, Revenant and Catalyst notes not fully read).
- A floor in billions next to the Main Bank Ceiling invited reading it as a balance, and its fill share r was never confirmed by CCP.

The sections below are kept as the record of how the estimate was built.

## Correction to the premise
The Reserve Bank existed from the ESS rework (patch 18.11, Nov 2020) but was locked with no way to open it until **The Grand Heist (27 Jul 2021)** added keys. The ~20T was accumulated organically, not seeded.
- [ESS Update devblog, 2020-10-30](https://www.eveonline.com/news/view/encounter-surveillance-system-update): keys "will come from gameplay content at a later date" (H)
- [Grand Heist now live, 2021-07-27](https://www.eveonline.com/news/view/the-grand-heist-now-live), [The Grand Heist](https://www.eveonline.com/news/view/the-grand-heist) (H)
- [TAGN](https://tagn.wordpress.com/2021/07/27/ccp-releases-the-ess-reserve-bank-keys-and-hands-out-isk-in-eve-online/): 20T "piling up and inaccessible since the introduction of the mandatory ESS structures" (M)

## 1. What feeds it
- A share of each nullsec NPC bounty (after the DBS modifier) goes to the ESS. Most goes to the Main Bank and "a smaller portion" to the Reserve ([ESS devblog](https://www.eveonline.com/news/view/encounter-surveillance-system-update), [18.11 notes](https://www.eveonline.com/news/view/patch-notes-for-version-18-11)) (H). Grand Heist: "a small part ... from each pirate bounty paid in a Nullsec system" (H).
- The exact split is not published. Player estimates only:
  - ESS takes 40% of the BRM-modified bounty (60 direct, ~20 main, ~20 reserve if equal; the poster is unsure) ([thread](https://forums.eveonline.com/t/brm-ess-isk-payouts/361667)) (L).
  - Main 35%, Reserve 5% ([ESS Payout?](https://forums.eveonline.com/t/ess-payout/332417)) (L).
  - CCP_TrashMob (Nov 2020) only says the reserve is "smaller... doesn't empty and just keeps building" ([Singularity thread](https://forums.eveonline.com/t/encounter-surveillance-system-rework-and-dynamic-bounty-systems-are-now-on-singularity/278112)) (H, no numbers).
- Patch 2022-02-08.1: DBS floor raised 30% to 50%. At the minimum modifier, 100% of bounties are paid directly "with 50% of each bounty entering the ESS Bank". Max Reserve payout +33.3%. Dev comment: "increasing the amount that goes into the reserve banks by taking from what was previously being lost" and "ESS Main / Reserve bank funneling where previously the sum was 58.2%" (ambiguous). Source: [mirror](https://skoli.ru/en/updates/eve-online/20-02-2022-02-08-1); confirmed in the [official 20.02 notes](https://www.eveonline.com/news/view/patch-notes-version-20-02) (H). The 50% applies only at the DBS floor, which 20.09 removed; see [bounty-calibration.md](bounty-calibration.md).
- DBS modifier applies to nullsec only (not hisec, lowsec, wormholes, Triglavian). It rises with ship losses and falls with ratting. Equilibrium 135%, max 180% after 2020-12-01 ([18.11](https://www.eveonline.com/news/view/patch-notes-for-version-18-11)) (H). DBS thresholds were tweaked again 2021-10-13 ([19.09 notes](https://www.eveonline.com/news/view/patch-notes-version-19-09)).
- Other income (rogue analysis beacons, etc.): none found; only NPC bounties are documented (absence not proven).

## 2. Per system or region; cap or decay
- Per ESS, which means per nullsec system. The ESS is "present by default in all claimable null security space" ([18.11](https://www.eveonline.com/news/view/patch-notes-for-version-18-11)) (H). Only the unlock alert and key validity are regional.
- No documented cap or decay. A 50B cap plus regional vault is a player proposal ([thread](https://forums.eveonline.com/t/regional-ess-vault/398106)) (M that none exists).

## 3. Initial balance
- No seed found. The ~20T was organic accumulation from Nov 2020 to Jul 2021 ([TAGN](https://tagn.wordpress.com/2021/07/27/ccp-releases-the-ess-reserve-bank-keys-and-hands-out-isk-in-eve-online/), [Grand Heist](https://www.eveonline.com/news/view/the-grand-heist)). No per-system distribution was published.
- Player anecdotes of reserve size: "48b in pot" vs "20m bank", "trillions in richest regions" ([thread](https://forums.eveonline.com/t/ess-reserve-bank-an-underwhelming-design-and-what-it-could-have-been/349355)) (L).

## 4. Drains
- Reserve Security Keys: 8 types, 4 map quadrants (SW/SE/NE/NW) x 15 or 45 min. Keys come from lowsec SCC Secure Key Storage sites. Funds move to cargo every minute as encrypted bonds (converted at an NPC). The rate ramps to a maximum then falls until the unlock ends. TAGN: peak ~150M ISK/min, so a 45 min key is at most a few billion. It does not empty the bank ([Grand Heist](https://www.eveonline.com/news/view/the-grand-heist), [TAGN](https://tagn.wordpress.com/2021/07/27/ccp-releases-the-ess-reserve-bank-keys-and-hands-out-isk-in-eve-online/)) (H/M).
- Whether payout scales with balance is unknown. 20.02 (2022-02-08) raised max payout 33.3%, so the peak is probably ~200M/min now (inferred, M). A player says the amount is the same regardless of linker count ([thread](https://forums.eveonline.com/t/are-reserve-banks-broken/386452)) (L).
- The Reserve never auto-pays. The Main Bank pays contributors every 2h45m (19.03; was 3h, then 2h) or can be hacked in 6.5 min (H). Alliances "nationalize" reserves by running their own keys (M).
- No other drain found.

## 5. Observability
- In-game only: an unlock alerts the whole region, and the Agency window shows ESS bank amounts filtered by 2/5/10 jumps or region ([EVE Uni](https://wiki.eveuniversity.org/Encounter_Surveillance_System), flagged out of date) (M). No public ESI endpoint for ESS balances found (not exhaustively verified).
- MER: reports cover the bounty faucet, with regional breakdowns discussed in forum threads. I found no ESS/reserve breakdown ([Feb 2025](https://www.eveonline.com/news/view/monthly-economic-report-february-2025), [Mar 2026](https://www.eveonline.com/news/view/monthly-economic-report-march-2026); full contents not read) (L). Check the MER data download for bounties by region.
- Killmails of key-user ships at an ESS are public (inference) but give no amounts.

## 6. Community tools
None found that estimate reserve banks. Closest: a wallet-journal ratting tracker ([forum](https://forums.eveonline.com/t/new-eve-fleet-mining-ratting-tool/512000)). Alliance-internal intel likely exists but is not public.

## 7. Uncertain or changed
- Exact reserve share of each bounty (5% to 20% candidates) and its variation with DBS.
- The 20.02 (2022-02-08) change to max payout. The "58.2%" remark is explained in [bounty-calibration.md](bounty-calibration.md).
- Legion 2025: Marauders blocked from the Main Bank room; 2024-10-30 deployable restriction (secondary mirror, unverified). Nothing found for Equinox 2024 or 2026 affecting fill.
- Dec 2022 forum complaint that reserves "build at such a slow rate" after unspecified changes (L).
- Whether unlock payout changed after 2022.

## Implications for estimating
Public data: hourly ESI `npc_kills` per system (counts, not ISK). No bounty values or balances.

Model per nullsec system s:
`Reserve(s) ~= sum_h kills(s,h) * avgBounty * DBS * f_ess * f_reserve - drains`

1. avgBounty: calibrate as MER regional bounty total divided by regional npc_kills (per region, per month).
2. DBS: unobservable per system via ESI. Use a constant (~1.0 to 1.35) or scale loosely with `ship_kills`/`pod_kills`.
3. f_ess * f_reserve: parameter with a prior band of 0.05 to 0.20 of base bounty. Calibrate with one in-game Agency observation per system class.
4. 30 days of data gives only recent accrual, a floor. Report "30-day accrual" plus an unknown prior principal. Years of accumulation dominate in busy regions.
5. Rank, do not quote: relative ranking by 30-day kills is robust, absolute ISK has roughly 4x uncertainty. Show low/high bands.
6. Drains: flag systems with recent key-user killmails near the ESS as possibly drained (a few B per key).
