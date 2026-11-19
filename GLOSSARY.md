# ESS Robber Intel

Intel for players who rob Encounter Surveillance Systems: which systems in a region could hold the most ISK worth stealing right now.

## Actors

**Robber**:
A player who breaks into an ESS to steal its banked ISK. The only audience of this tool.
_Avoid_: User (too generic), thief, hacker

**Ratter**:
A player killing NPCs for bounties in a nullsec System; the source of everything an ESS holds.
_Avoid_: Farmer, PvE pilot

## The ESS

**ESS**:
The Encounter Surveillance System, which skims a share of NPC bounties into its banks. Only sov-held nullsec has one: NPC nullsec (faction-held) and unclaimed nullsec have none.
_Avoid_: Encounter Surveillance System (spell out only once), bank (the ESS has two)

**Main Bank**:
The ESS datavault that accumulates a share of bounties and pays it out to contributing Ratters each Payout Cycle; a Robber can steal it before payout.
_Avoid_: ESS value, payout pool

**Reserve Bank**:
The locked ESS datavault that never pays out on a schedule and opens only with a Reserve Security Key.
_Avoid_: Reserve, secondary bank

**Payout Cycle**:
The fixed 2h45m interval after which a Main Bank pays out and starts accumulating again. Its phase for any given System is unknowable from outside the game.
_Avoid_: Tick, payout timer

**Robbery**:
A Robber draining a Main Bank. Not publicly observable.
_Avoid_: Heist (reserved by CCP for the Reserve Bank event), hack

## What the tool reports

**Main Bank Ceiling**:
The most ISK a System's Main Bank could currently hold: the modelled bank share of all bounties paid in that System over the last full Payout Cycle. The true balance lies between zero and this.
_Avoid_: Estimated Main Bank, payout value, ESS value, bank value

**Robber Take**:
The share of a Main Bank Ceiling a Robber would actually walk away with (about 80%).
_Avoid_: Loot, profit

**Reserve Bank Estimate**:
This tool's low–high band for how much ISK a Reserve Bank has gained during the history we hold. A floor on the true balance, never the balance itself. Provisional: kept only if it proves useful.
_Avoid_: Reserve value, reserve balance (implies measured)

**Bounty Assumptions**:
The tunable figures that turn NPC kill counts into ISK: ISK per NPC kill by Region (calibrated monthly from CCP's Monthly Economic Report, with a pooled fallback), the Payout Cycle length, the Main Bank share of bounties, the Robber Take share, and the reserve fill share band.
_Avoid_: Magic numbers, constants

**Warming Up**:
A System whose recorded history does not yet cover a full Payout Cycle, so its Main Bank Ceiling is incomplete.
_Avoid_: Pending, no data

**Surge**:
A rise in a System's Main Bank Ceiling since the previous pull that meets or exceeds the Robber's chosen Surge Threshold. Drops are never Surges, and neither is a rise while either ceiling is Warming Up.
_Avoid_: Change, spike, highlight

**Surge Threshold**:
The minimum ISK increase, set by the Robber, for a rise to count as a Surge.

**Stale**:
Figures whose last successful pull is an hour old or more, so they may lag reality. Every System in a Region shares one pull, so Stale applies to the whole Region view. Figures under an hour old are Recent.
_Avoid_: Outdated, expired

## Geography

**Region**:
The top-level area a Robber filters by; contains Constellations. Also the unit ISK per NPC kill is calibrated for, since Regions differ in what their NPCs pay.

**Constellation**:
A group of Systems within a Region; the middle level of the browse hierarchy, reported with the sum of its Systems' Main Bank Ceilings.

**System**:
A single sov-held nullsec solar system, the only kind with an ESS; the unit a Main Bank Ceiling is reported for. NPC nullsec and unclaimed nullsec are excluded, as are wormhole space, Pochven and the Jove Regions. Sovereignty changes: a System is in scope while the latest daily sovereignty refresh shows an alliance holding it.
_Avoid_: Solar system, star
