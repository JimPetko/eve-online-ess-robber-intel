# Report a Main Bank Ceiling modelled from NPC kills, not a measured balance

Public ESI exposes no ESS bank balances and no bounty ISK, only an hourly `npc_kills` count per System (`/universe/system_kills`), and the phase of each System's 2h45m Payout Cycle is invisible. So we report a **Main Bank Ceiling**: NPC kills over the last Payout Cycle × ISK-per-kill for the System's Security Band × the Main Bank share of bounties, all held as tunable Bounty Assumptions. We rank Systems by this upper bound because Robbers hunt for potential; the true balance lies anywhere between zero and the ceiling.

## Considered Options

- **Expected value (≈ half the ceiling)**: rejected. It assumes a uniformly random payout phase and still can't be right for any single System, while hiding how big a bank *could* be.
- **Reporting both ceiling and expected value**: rejected as noise; the expected value is a fixed fraction of the ceiling and changes no ranking.
- **Third-party data (zKillboard) to detect Robberies**: deferred, to keep v1 on public ESI only.

## Consequences

- A robbed or freshly paid-out bank keeps showing a full ceiling until its contributions age out of the window (up to one Payout Cycle). The UI must say so.
- Accuracy depends on the Bounty Assumptions (the ~40% Main Bank share and ISK per kill are unverified). Calibration against real payouts from a Ratter's wallet journal needs SSO and is planned for v2.
- Any future "real" bank figure would be a different term, not a refinement of this one.
