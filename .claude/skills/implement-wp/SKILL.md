---
name: implement-wp
description: Implement one Snipes Web work package with the tests → implement → verify → fix loop (spec 9.2), then commit, push and open a PR.
argument-hint: <WP>
arguments: [wp]
disable-model-invocation: true
effort: high
---

Implement work package $wp from 9.1 of `SPEC.md`. Handle only this work package. `$wp` is two digits, for example `04`.

## Before starting

Run `git fetch --prune origin`. If local `main` is only behind `origin/main` (`git rev-list origin/main..main` prints nothing), fast-forward it without asking: `git merge --ff-only origin/main` when `main` is checked out, otherwise `git fetch origin main:main`.

Stop and tell Martin if any of these fails:

- The working tree is clean, and local `main` has no commits that are not on `origin/main`.
- Every dependency of $wp in 9.1 is done: `git log origin/main --oneline` has a commit whose subject ends with `(WP NN)` for it. "all" means every other package.
- No branch `wp$wp` exists yet, locally or on `origin`.

Then create the branch: `git switch -c wp$wp --no-track origin/main`.

## 1. Tests

Start the `test-writer` agent with only `Write the tests for work package $wp.`. If it reports the spec as unclear, stop and ask Martin.

Check that it changed only files under `tests/`, then commit them with the subject `Add tests for WP $wp`. Keep its report of the API for the developer.

## 2. Implement → verify → fix

Allow at most 3 verification rounds.

1. **Implement.** Start the `developer` agent with the work package ID and the test-writer's API list. In later rounds, send it the verifier's findings exactly as written.
2. **Verify.** Run `/verify $wp`. It always starts a new `verifier`. Do not pass on anything from the developer.
3. **Decide.**
   - PASS: go to step 3.
   - FAIL or INVALID, with rounds left: go back to 2.1.
   - FAIL or INVALID after round 3: stop, leave the changes uncommitted, and report the remaining findings to Martin.

Do not edit the code yourself between rounds, because that change would skip the developer step. If the developer reports a finding as wrong, a test as wrong, or the spec as unclear, stop and ask Martin.

## 3. Commit and PR

Commit exactly what was verified. Any further edit needs a new verification round.

1. Commit with a short, descriptive subject ending in `(WP $wp)`, and the trailer `Verified: PASS` before the attribution trailers.
2. Push the branch and open a PR to `main`. The body says what the package does and includes the verdict table.
3. Run `/ci-status`.
4. Report the verdict, the PR URL and the CI result. Martin reviews the preview, merges and approves the deploy (spec 9.2 steps 4–5).
