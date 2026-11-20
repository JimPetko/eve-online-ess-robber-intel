# Report a Main Bank Ceiling modelled from NPC kills, not a measured balance

Public ESI exposes no ESS bank balances and no bounty ISK, only an hourly `npc_kills` count per System (`/universe/system_kills`), and the phase of each System's 2h45m Payout Cycle is invisible. So we report a **Main Bank Ceiling**: NPC kills over the last Payout Cycle × ISK-per-kill for the System's Region × the Main Bank share of bounties, all held as tunable Bounty Assumptions. We rank Systems by this upper bound because Robbers hunt for potential; the true balance lies anywhere between zero and the ceiling.

## Considered Options

- **Expected value (≈ half the ceiling)**: rejected. It assumes a uniformly random payout phase and still can't be right for any single System, while hiding how big a bank *could* be.
- **Reporting both ceiling and expected value**: rejected as noise; the expected value is a fixed fraction of the ceiling and changes no ranking.
- **Third-party data (zKillboard) to detect Robberies**: deferred, to keep v1 on public ESI only.

## Consequences

- A robbed or freshly paid-out bank keeps showing a full ceiling until its contributions age out of the window (up to one Payout Cycle). The UI must say so.
- Accuracy depends on the Bounty Assumptions. ISK per kill is calibrated per Region from CCP's Monthly Economic Report (regional bounties ÷ the Region's ESI NPC kills, archived by EVE Ref), with a pooled fallback for Regions without enough sov-null data. Those bounties exclude the Reserve share. The same data puts the Main Bank share at about 40% of them. See [research](../research/bounty-calibration.md).
- The calibration ages. Rerun `node scripts/calibrate-bounties.mjs <YYYY-MM>` each month once the MER is out, and commit the generated table. Per-System calibration from a Ratter's wallet journal needs SSO and stays a v2 idea.
- Any future "real" bank figure would be a different term, not a refinement of this one.
- The Reserve Bank first got the same treatment, inverted, as a 30-day floor on accrual. It was cut on 2026-11-19: a reserve key pays out on a fixed curve whatever the balance, so no Reserve figure changes a Robber's choice. See [research](../research/reserve-bank.md#decision-2026-11-19-cut-the-reserve-bank-estimate).
