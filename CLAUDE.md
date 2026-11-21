# Agent rules

- Every behaviour change ships with tests. Each test asserts what a user or caller observes, such as an API response or rendered text, not internal calls.
- CI's `tests-required` job fails a PR that changes code under `src/` without changing a `*.test.ts(x)`. Add the `no-tests-needed` label only for docs, CSS-only changes, or a pure refactor that existing tests already cover. Say why in the PR body.
- Merge only with `node scripts/merge-pr.mjs <pr-number>`. Never run `gh pr merge` or use the merge button. Branch protection on `main` requires the `check`, `docker` and `tests-required` checks, and the script merges only the exact head commit it checked. It refuses a draft, an unmergeable PR, or a head commit where any check is pending or failed, and it merges that exact commit.
- Read `GLOSSARY.md` first. Use its terms in code, tests, docs and PRs, and avoid the words it lists under _Avoid_.
- Keep each Plane work item's status in step with its PR's status. Keep Plane tokens and other secrets out of the repo.
