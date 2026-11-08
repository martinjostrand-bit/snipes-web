# Snipes Web

Single-player browser remake of the 1982 maze shooter Snipes, in TypeScript with no runtime dependencies.

`SPEC.md` is the source of truth for rules, architecture, work packages (9.1) and decisions (11). Refer to it by section number and do not repeat it here. If code and spec disagree, raise it with Martin instead of choosing silently.

## Commands

```sh
npm run dev       # local dev server
npm run check     # tsc + ESLint (warnings are errors) + Prettier check
npm test          # Vitest unit + simulation tests, coverage threshold on src/core
npm run build     # production build to dist/
npm run test:e2e  # build, then Playwright tests in Chromium, Firefox and WebKit
```

## Conventions

- `src/core/` is pure game logic: no DOM, no timers, no `Math.random` or `Date.now` (lint-enforced, spec 4.3). It never imports from `render/` or `input/`.
- The version is only in `package.json` `version` (spec 5.5).
- Tests name the spec section they check, e.g. `describe("2.3 Hives", …)`.
- LF line endings everywhere. Never commit `node_modules/`, `dist/` or `coverage/`.

## Roles (spec 5.7)

| To do this                          | Use                       |
| ----------------------------------- | ------------------------- |
| Implement a work package (WP 04 on) | `/implement-wp <WP>`      |
| Verify the current change           | `/verify [<WP>]`          |
| Check new or changed spec text      | The `spec-reviewer` agent |
| Check CI for the current commit/PR  | `/ci-status`              |
| Publish a release                   | `/release`                |

Writing tests, implementing and verifying are done by different agents (`test-writer`, `developer`, `verifier`). Whoever writes a change does not verify it. Do not fix findings inside a verification run, and do not summarise your reasoning to the `verifier`. Never change files under `tests/` while implementing; a test change needs its own PR.

## Definition of done

1. `npm run check`, `npm test`, `npm run build` and `npm run test:e2e` pass, with no warnings.
2. The `verifier` verdict for that exact change is PASS. If the change was edited after the verdict, verify it again.
3. The commit subject ends with `(WP NN)` and the message has the trailer `Verified: PASS`, before any attribution trailers. Never write `Verified: PASS` without a PASS verdict for that exact change.
4. Push the branch and open a PR to `main` with the GitHub account `martinjostrand-bit`. `main` is protected, so never push to it directly. Check CI with `/ci-status`.
5. The PR's required checks are green, and Martin has merged it and approved the production deploy.

## Rules against over-engineering (spec 8)

1. Write the code the current milestone needs, nothing for "later".
2. No interface, factory, plugin system or config option with only one user.
3. Prefer plain functions and data over class hierarchies.
4. A new dependency needs a one-line reason in the PR description.
5. If a change makes the code longer without making a test pass or a bug go away, question it.
6. When in doubt, ask Martin rather than adding flexibility.
