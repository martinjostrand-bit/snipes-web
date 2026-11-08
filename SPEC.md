# Snipes Web — Specification

Nov 8, 2026 · @Martin · Draft v0.3

- v0.2: sections 5 and 7 filled in from the HundAlder project's GitHub and publishing setup.
- v0.3: CI, build and quality principles adopted from the MissingFiles project (5.2–5.7, 6.3–6.4, 9, 11).

## 1. Overview and goals

We are building a faithful-in-spirit, single-player browser remake of Snipes, the 1982 text-mode maze shooter by SuperSet Software. The player roams a scrolling, wrap-around maze, shooting snipes and destroying the hives that spawn them.

**Goals**

- Captures the feel of the original: fast, grid-based, readable, slightly frantic.
- Runs in any modern desktop browser with no install and no backend.
- Built and tested in a professional way, so the code stays easy to change.
- Small enough that one person can understand the whole codebase.

**Guiding principles**

1. **Simplest thing that works.** No abstraction until there is a second real use for it. No framework where plain TypeScript will do.
2. **Pure game logic.** All rules live in plain functions/classes with no DOM, timers or randomness from outside. Rendering and input are thin layers on top.
3. **Deterministic.** Given the same seed and input sequence, the game produces the same result. This is what makes independent testing possible.
4. **Behaviour first.** This spec describes what the game does, not how to code it. Implementation details are decided in code review.
5. **Original work.** We recreate the gameplay, not the original code, graphics or text. No copyrighted assets are copied.

## 2. Gameplay

The game is a grid-based maze shooter: clear every hive and every snipe on a level to win it; lose all lives and the game ends. Rules marked _(verify)_ should be checked against the original before implementation (see Open questions).

### 2.1 Maze

- A rectangular grid of cells, larger than the screen. The view scrolls to keep the player centred.
- The maze **wraps around** at all four edges.
- A new maze is **generated randomly** from a seed for every game. The same seed always gives the same maze.
- Every open cell must be reachable from every other open cell.
- Walls are solid for the player, snipes and bullets, unless an option says otherwise.

### 2.2 Player

- Moves one cell at a time in **8 directions**: diagonal by holding one vertical and one horizontal key.
- Holding **Space** makes the player move faster.
- Movement and shooting are **independent**: the player can move one way and fire another.
- Walls block the player, snipes and bullets (ghosts excepted).
- Has a limited number of lives (default 5). On death the player respawns at a safe spot after a short delay.
- **Instant death** on touching an enemy, being hit by an enemy bullet, or touching a wall when deadly walls are on (see 2.6).

### 2.3 Hives (generators)

- Placed at random open spots when the level starts. Count is set by the skill digit (2.6).
- Animate (flash) so they are easy to spot.
- **Spawn continuously** while alive: a new snipe (or ghost, if enabled) at a fixed interval, as long as the number of enemies on the map is below the digit's maximum.
- **Withstand 20 hits.** The hive changes colour as it takes damage, so the player can see how close it is to breaking.
- On the 20th hit the hive is destroyed and stops spawning. Enemies it already spawned stay.

### 2.4 Snipes and ghosts

Hives spawn two kinds of enemy. Both die from **one hit**.

|              | Snipe                                                             | Ghost                                                               |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Walls        | Blocked, moves through corridors                                  | **Passes through walls**                                            |
| Movement     | Chases the player with some randomness, not perfect pathfinding   | Aggressive: heads straight for the player and tries to cut them off |
| Attack       | Fires along straight or diagonal lines of sight; kills on contact | Kills on contact; does not shoot _(verify)_                         |
| Hits to kill | 1                                                                 | 1                                                                   |
| Points       | 10                                                                | 10                                                                  |

Ghosts appear only when the skill letter enables them (2.6). "Creep" in some descriptions is another name for a snipe, not a third enemy type.

### 2.5 Bullets

- Fired in **8 directions** (W A S D, diagonal by holding two keys), independent of movement.
- Travel in a straight line, faster than any creature, until they hit an entity or a wall.
- By default a bullet that hits a wall disappears and the wall is unharmed.
- **Bouncy shots** (letter flag): _diagonal_ shots bounce off walls; straight shots still stop.
- **Destroyable walls** (letter flag): a bullet that hits a wall removes that wall segment. This applies to deadly walls too.

### 2.6 Skill level: letter A–Z + digit 1–9

Before a game the player enters a skill level such as `A1` or `M5`. The **letter** switches four rule features on or off; the **digit** sets how many hives there are and how many enemies may be on the map at once.

**Letter = which features are on.** The letters are combinations, not a smooth difficulty ramp: A and Q have no features, Z has all of them.

| Feature                    | Enabled for letters                      |
| -------------------------- | ---------------------------------------- |
| Ghosts                     | B, D, F, H, J, L, N, P, R, T, V, X, Y, Z |
| Bouncy diagonal shots      | C, D, G, H, K, L, O, P, S, T, W–Z        |
| Deadly (electrified) walls | E–H, M–P, U–Z                            |
| Destroyable walls          | I–P, Y, Z                                |

**Digit = hives and enemy density.**

| Digit              | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   |
| ------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hives              | 3   | 3   | 3   | 3   | 4   | 4   | 4   | 4   | 5   |
| Max enemies on map | 10  | 25  | 40  | 55  | 70  | 90  | 110 | 130 | 150 |

The letter-to-feature mapping lives in one small lookup table in `core/`, so it is easy to correct if the original turns out to differ.

### 2.7 Levels and scoring

- **Primary goal:** destroy every hive, which stops new enemies.
- **Secondary goal:** kill every remaining snipe and ghost. The level is cleared only when no hive and no enemy is left.

| Event          | Points                                                 |
| -------------- | ------------------------------------------------------ |
| Hive destroyed | 100                                                    |
| Snipe killed   | 10                                                     |
| Ghost killed   | 10                                                     |
| Level cleared  | Bonus from lives left and time taken (formula tunable) |

- Enemy speed and fire rate are tunable constants; they do not depend on the letter.
- The best score per skill level is stored locally in the browser.

### 2.8 Controls

| Action      | Keys                                  |
| ----------- | ------------------------------------- |
| Move        | Arrow keys (diagonal = two keys held) |
| Move faster | Hold Space                            |
| Fire        | W A S D (diagonal = two keys held)    |
| Pause       | P or Esc                              |
| Restart     | R (from the game-over screen)         |

Keys are rebindable later only if asked for; the first version has fixed keys. Gamepad and touch are out of scope.

### 2.9 Verification notes

Martin's description (7 Nov) was checked against the snipes(6) manual and a cheat-code page. Where they differ, the spec follows the sources:

| Topic                | Description said                          | Sources say                                   | Spec now              |
| -------------------- | ----------------------------------------- | --------------------------------------------- | --------------------- |
| Directions           | 4 for moving and firing                   | Diagonals by holding two keys                 | 8 directions          |
| Letter A–Z           | Gradual ramp: slow → fast enemies         | Four on/off features in combinations          | Feature table (2.6)   |
| Digit 1–9            | Hives (3–5 at level 1) + density          | 3/4/5 hives, 10–150 max enemies               | Digit table (2.6)     |
| Wall damage          | Only electrified walls can be neutralised | "Destroyable walls" is its own letter feature | Separate flag         |
| Bounce               | Not mentioned                             | Only diagonal shots bounce                    | Added                 |
| Speed key            | Not mentioned                             | Space moves faster                            | Added                 |
| Points, hive 20 hits | 100/10/10, 20 hits                        | Not found in sources                          | Kept from description |

## 3. Presentation

The game is drawn on a single HTML `<canvas>` in a retro text-mode style: a fixed character grid, a small palette, crisp pixels.

- **Look:** inspired by the original's line-drawing characters and smiley figures, but with our own original glyphs/sprites. Monospace grid, dark background.
- **Scaling:** the canvas scales in whole-number steps to fit the window, so pixels stay sharp. Minimum supported window: 1280×720.
- **HUD:** one status line with score, lives, level, hives left and snipes left.
- **Screens:** title/options → playing → paused → level cleared → game over. Nothing else.
- **Sound:** short beeps made with the Web Audio API (shot, hit, hive destroyed, death). Mute toggle with M. No audio files.
- **Frame rate:** rendering at the display's refresh rate; game logic at a fixed tick rate (see 4.3).

## 4. Technical architecture

A static single-page app in TypeScript, built with Vite, with no runtime dependencies and no backend.

### 4.1 Stack

| Concern              | Choice                                 | Why                                                           |
| -------------------- | -------------------------------------- | ------------------------------------------------------------- |
| Language             | TypeScript (strict mode)               | Type safety, good editor support                              |
| Build/dev server     | Vite                                   | Fast, minimal config, outputs static files                    |
| Rendering            | Canvas 2D API                          | Enough for a grid game; no game engine needed                 |
| Audio                | Web Audio API                          | Generated beeps, no assets                                    |
| Storage              | `localStorage`                         | High score and options only                                   |
| Hosting              | Cloudflare Workers, static assets only | Same Cloudflare account and pipeline as HundAlder (section 7) |
| Runtime dependencies | None                                   | Keeps it small and easy to maintain                           |

### 4.2 Module layout

Three layers. The core never imports from the other two.

```
src/
  core/        pure game logic: maze, entities, rules, rng, state
  render/      draws a GameState onto a canvas
  input/       maps keyboard events to an InputState
  main.ts      wires the layers together and runs the loop
tests/
  unit/        tests for core/
  sim/         headless whole-game simulations
  e2e/         browser tests
```

A flat structure within each folder is fine. Add sub-folders only when a folder passes roughly 10 files.

### 4.3 Game loop and determinism

- Logic runs at a **fixed tick** (e.g. 30 ticks/s) via an accumulator loop; rendering runs on `requestAnimationFrame`.
- The core exposes one main function: `step(state, input) → state`. No other way to change game state.
- All randomness comes from a **seeded PRNG** (e.g. mulberry32) stored in the state. `Math.random()` and `Date.now()` are banned in `core/` (enforced by lint rule).
- A game is fully described by `(seed, options, input log)`. This enables replays, bug reports and simulation tests.

## 5. Build environment and tooling

One repository on Martin's existing GitHub account, with a small set of standard tools, all run the same way locally and in CI.

### 5.1 Repository

- Repo: `martinjostrand-bit/snipes-web`, on the same GitHub account as HundAlder (`martinjostrand-bit/hundalder-kalkylator`).
- **Public**, like HundAlder. On GitHub's free plan, branch protection and the required-reviewer gate on the `production` environment (section 7) only work on public repositories.
- Default branch `main`, protected: changes land via pull request with green CI. (HundAlder uses `master` without branch protection; this project uses `main` and protects it.)
- Commits are authored as `Martin Strand <martin.jo.strand@pm.me>`, the same git identity as HundAlder. `gh` is logged in as `martinjostrand-bit`.
- Files at the root: `README.md` (how to run, build, test, deploy, approve a production deploy), `SPEC.md` (this document), `CLAUDE.md` (5.7), `.claude/` (5.7), `LICENSE`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.nvmrc`, `wrangler.jsonc` (section 7).
- Node 24 LTS pinned in `.nvmrc`, `package.json` `engines` and the CI workflow. The pinned Wrangler needs Node ≥ 22 (HundAlder's CI broke on Node 20 for this reason); Node 22, which HundAlder uses, reaches end of life in April 2027. One package manager (npm), lockfile committed.

### 5.2 Tools

| Tool                                                             | Purpose                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| TypeScript `tsc --noEmit`                                        | Type check (strict)                                                            |
| ESLint (flat config, typescript-eslint `recommendedTypeChecked`) | Lint with `--max-warnings 0`, incl. ban on `Math.random`/`Date.now` in `core/` |
| Prettier                                                         | Formatting (`prettier --check` in `npm run check`), no style debates           |
| Vitest                                                           | Unit and simulation tests, coverage with enforced thresholds (5.6)             |
| Playwright                                                       | End-to-end browser tests                                                       |
| `npm audit`                                                      | Fails CI on known high or critical vulnerabilities in any dependency           |
| GitHub CodeQL                                                    | Security and quality scan of the TypeScript code (5.4)                         |

No other tools unless a real problem calls for one. No monorepo tooling, no Docker, no custom build scripts.

### 5.3 npm scripts

| Script             | Does                                        |
| ------------------ | ------------------------------------------- |
| `npm run dev`      | Local dev server with hot reload            |
| `npm run build`    | Production build to `dist/`                 |
| `npm run check`    | Type check + lint + format check            |
| `npm test`         | Unit + simulation tests                     |
| `npm run test:e2e` | Playwright tests against a production build |

### 5.4 Continuous integration

GitHub Actions, two workflows.

**`.github/workflows/deploy.yml`** is modelled on HundAlder's. It runs on every pull request to `main`, every push to `main`, and on demand (`workflow_dispatch`). It has three jobs:

| Job       | Runs on                               | Steps                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`  | PRs and pushes                        | `npm ci` → `npm audit --audit-level=high` → `check` → `test` (with coverage) → `build` → `test:e2e` → `wrangler deploy --dry-run` → upload `dist/` as a workflow artifact. Coverage and the Playwright report are uploaded as artifacts even when a step fails. |
| `preview` | PRs only, after `checks`              | Download `dist/` → `wrangler versions upload` → comment the preview URL on the PR                                                                                                                                                                               |
| `deploy`  | Pushes to `main` only, after `checks` | Download `dist/` → `wrangler deploy`; runs in the `production` environment, so it waits for Martin's approval                                                                                                                                                   |

**`.github/workflows/codeql.yml`** is modelled on MissingFiles'. It runs CodeQL with language `javascript-typescript`, build mode `none` and the `security-and-quality` queries. It runs on every PR, every push to `main`, and weekly on Monday 04:00 UTC, so new queries also check code that has not changed.

- `checks` and CodeQL's code scanning check are the required status checks for merging. A failing step, or a new high-severity CodeQL alert on a PR, blocks the merge.
- Least privilege: both workflows set `permissions: contents: read` at the top. Only the jobs that need more get it: `preview` gets `pull-requests: write`, and CodeQL gets `security-events: write`.
- `preview` and `deploy` ship the exact `dist/` that `checks` tested, not a rebuild.
- All Wrangler steps use Wrangler `4.131.2`, the version HundAlder pins, so Wrangler is not an npm dependency. `preview` and `deploy` use `cloudflare/wrangler-action@v4` (HundAlder: v3; v4 only changes the default Wrangler version). The dry run in `checks` runs Wrangler directly, because it needs no credentials.
- `preview` is skipped for Dependabot and fork PRs, which cannot read the Cloudflare secrets. `deploy` ends with the e2e smoke test against the production URL.
- Unlike HundAlder, the workflow has **no `paths-ignore: "**.md"`**. Changes to `SPEC.md` matter here, and with branch protection a skipped required check would leave doc-only PRs unmergeable.
- Dependabot runs weekly for the `npm` and `github-actions` ecosystems.

### 5.5 Versioning

- Semantic version `MAJOR.MINOR.PATCH`, shown on the title screen.
- Defined in one place, `package.json` `version`, and changed by hand. The build injects it into the page. Nothing else holds a copy.
- Between two releases, each of MAJOR, MINOR and PATCH goes up at most once. Changes that only affect documentation, tests or CI do not change the version.
- A release is a commit on `main` with a passing CI run and an approved production deploy. It is tagged `vX.Y.Z` and published as a GitHub Release, with its section of `CHANGELOG.md` as the notes, by `/release` (5.7).
- Commit messages in plain imperative English with a short, descriptive subject; Conventional Commits optional.

### 5.6 Build and quality rules

These are adapted from the MissingFiles project (a .NET app on the same GitHub account), with each .NET tool replaced by its npm counterpart.

1. **Warnings are errors.** `tsc` runs in strict mode and ESLint runs with `--max-warnings 0`. A rule that is not worth following is turned off in the ESLint config with a comment saying why. An inline `eslint-disable` needs a `-- reason`, and unused disable directives are errors.
2. **The same checks locally and in CI.** CI runs only the npm scripts in 5.3, so `npm run check && npm test && npm run build && npm run test:e2e` locally gives the same answer as CI. The exceptions are CodeQL and the Wrangler dry run, which need GitHub and Cloudflare.
3. **Coverage is enforced, not only reported.** The coverage target in 6.1 is a Vitest `coverage.thresholds` entry for `src/core/**`, so coverage below 90 % of lines makes `npm test` fail.
4. **Pinned toolchain.** Node is pinned in `.nvmrc` and `engines`. The lockfile is committed and CI uses `npm ci`. Wrangler's version is pinned in the workflow, and actions are pinned to a major version. Dependabot proposes the updates.
5. **Build once, ship what was tested.** `preview` and `deploy` publish the `dist/` artifact from `checks` (5.4).
6. **Never commit build output.** `.gitignore` covers `node_modules/`, `dist/`, `coverage/`, `test-results/`, `playwright-report/` and `.wrangler/`.
7. **One line-ending policy.** All files use LF, enforced by `.gitattributes` (`* text=auto eol=lf`), `.editorconfig` (`end_of_line = lf`) and Prettier. MissingFiles uses CRLF because it is Windows-only. A web project uses LF so that the format check gives the same result on every OS and in CI.
8. **Security in the pipeline and in the repository.** The pipeline runs CodeQL, `npm audit` and Dependabot. Secret scanning and push protection are GitHub repository settings, not pipeline steps. `/release` checks that both are on before it publishes (5.7).
9. **Slow tests move, they don't disappear.** A test that no longer fits the time budgets in 6.1 moves to a scheduled workflow, like MissingFiles' nightly performance test. It is not deleted or skipped.
10. **The spec is the source of truth.** Tests name the spec section they check, for example `describe('2.3 Hives', …)`. When code and spec disagree, raise it with Martin instead of choosing silently. If the spec is wrong, it is changed first, in its own PR.

### 5.7 Claude Code configuration

Claude Code is the development tool. Its configuration is in the repository, so every session works the same way. This follows MissingFiles' DEV-01 to DEV-07, adapted to pull requests.

| File                                   | Content                                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                            | Commands, conventions, the roles below, the definition of done, and the rules in section 8. It refers to `SPEC.md` instead of repeating it.                                                                                                  |
| `.claude/settings.json`                | Permissions. `npm run check`, `npm test`, `npm run build`, `npm run test:e2e` and read-only `git` and `gh` commands run without a prompt. `git push --force` and `git reset --hard` are denied. `gh api` prompts, because it can also write. |
| `.claude/agents/`                      | The agents below                                                                                                                                                                                                                             |
| `.claude/skills/`                      | The skills below                                                                                                                                                                                                                             |
| `.claude/hooks/verifier-bash-guard.js` | `PreToolUse` hook. Inside the `verifier`, it allows only read-only `git` commands, simple text filters and the four check commands exactly as written, and blocks everything else.                                                           |

**Agents**, each with its effort level set in its definition:

| Agent           | Does                                                                                                                                | Can change files   | Effort                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------- |
| `test-writer`   | Writes a work package's tests from the spec, before any code (6.3)                                                                  | Yes, `tests/` only | `high`                                   |
| `developer`     | Implements a work package until its tests pass, and fixes verifier findings. Does not change those tests, the spec, commit or push. | Yes                | `high`                                   |
| `verifier`      | Verifies a change independently (6.3)                                                                                               | No                 | `high`; `xhigh` when `src/core/` changes |
| `spec-reviewer` | Checks new or changed spec text for ambiguity, conflicts and testability                                                            | No                 | `high`                                   |

**Skills:**

| Skill                | Does                                                                                          | Effort   |
| -------------------- | --------------------------------------------------------------------------------------------- | -------- |
| `/implement-wp <WP>` | Runs the loop in 9.2 for one work package                                                     | `high`   |
| `/verify [<WP>]`     | Starts a new `verifier` on the current change and reports its verdict                         | `high`   |
| `/ci-status`         | Reports the CI result for the current commit or PR                                            | `low`    |
| `/release`           | Runs the release steps in 5.5, after checking that secret scanning and push protection are on | `medium` |

**Definition of done** for a work package:

1. `npm run check`, `npm test`, `npm run build` and `npm run test:e2e` pass locally, with no warnings.
2. The `verifier` verdict for that exact change is PASS. The commit carries the trailer `Verified: PASS`. A trailer, not the last line, so attribution trailers can follow it. A change edited after the verdict is verified again. `Verified: PASS` is never written without a PASS verdict.
3. The PR's required checks are green, and Martin has merged it and approved the production deploy (9.2).

MissingFiles commits verified changes straight to `main`. SnipesWeb keeps pull requests, because `main` is protected and every change gets a preview deploy (section 7).

## 6. Testing strategy

Tests are derived from this spec, not from the code, and are owned separately from the implementation so they act as an independent check.

### 6.1 Test levels

| Level      | What it checks                                                                              | Tool                                   | Target                         |
| ---------- | ------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------ |
| Unit       | Single rules in `core/`: maze connectivity, wrap-around, collisions, bullet travel, scoring | Vitest                                 | ≥ 90% line coverage of `core/` |
| Simulation | Whole games run headless from a seed + scripted input; invariants hold every tick           | Vitest                                 | Runs in < 30 s                 |
| End-to-end | Real browser: game loads, starts, responds to keys, pauses, game over, high score saved     | Playwright (Chromium, Firefox, WebKit) | Smoke suite < 2 min            |

Rendering and audio are not unit-tested; they are covered by e2e smoke tests and manual play.

### 6.2 Invariants checked in simulation

- Every open cell is reachable; no player, snipe or bullet is ever inside a wall (ghosts may be).
- A hive is destroyed after exactly 20 hits, never earlier or later; a destroyed hive never spawns again.
- The number of enemies never exceeds the digit's maximum; counts never go negative.
- Each letter enables exactly the features in the 2.6 table, no more.
- The same seed + input log always produces the same final state (determinism test).
- A level with zero hives, snipes and ghosts is always marked cleared.

### 6.3 Independence rules

1. **Tests first, from the spec.** For each work package, the `test-writer` writes the acceptance tests from sections 2 and 9 before the feature code.
2. **Separate roles.** Writing tests, implementing and verifying are done by different agents (5.7), each in its own context. The `developer` must not edit acceptance tests to make them pass; a test change needs its own pull request with a reason.
3. **Independent verification** (from MissingFiles DEV-04):
   - The `verifier` starts in a new context. It gets only the spec, the work package ID and the diff, never the developer's reasoning, summary or test results.
   - It runs the four checks itself and does not rely on reported results. Reading a test is not enough: the verifier confirms the test asserts the required behaviour and that it ran.
   - It checks that the acceptance tests from rule 1 are unchanged since the `test-writer` commit.
   - It reports and never fixes. Its verdict is PASS or FAIL, with a table of each in-scope spec item (result, whether a test exists, evidence as test name, `file:line` or command output) and a numbered list of findings.
   - PASS needs every item to pass, all four checks to succeed and no findings. An item it could not check is a fail.
   - `/verify` hashes the repository state before and after. If the verifier changed anything, the result is INVALID.
   - The verifier cannot run `gh`. GitHub repository settings are outside its scope.
   - No agent verifies its own work. A fix is checked by a new `verifier` run.
4. **CI is the referee.** Only a green CI run counts as passing, never "works on my machine".
5. **Manual play check.** Before each release, Martin plays one full game and ticks the checklist in 6.4 in the release PR.
6. **Bugs get a test.** Every bug fix starts with a failing test (often a recorded seed + input log).

### 6.4 Play checklist (manual, per release)

- A new player can start a game and understand the controls without reading the README.
- Movement and firing feel responsive at the target tick rate, with no visible stutter in a full game.
- Every screen in section 3 can be reached and left by keyboard only.
- The canvas scales sharply at 1280×720 and at the largest window size available, and nothing is cut off.
- Sound and mute work, and nothing appears in the browser console during play.

## 7. Deployment and publishing

The build output is static files in `dist/`. They are published to Cloudflare Workers by the GitHub Actions workflow in 5.4, with the same Cloudflare account and the same pipeline as HundAlder.

- **Hosting:** a Cloudflare Worker named `snipes-web` that serves only static assets. No Worker script, no KV, no server code. Configuration in `wrangler.jsonc`:

  ```jsonc
  {
    "name": "snipes-web",
    "compatibility_date": "<date of WP 02>",
    "assets": { "directory": "./dist" },
  }
  ```

  Because only `dist/` is published, HundAlder's `.assetsignore` is not needed.

- **Production URL:** `https://snipes-web.martin-jo-strand.workers.dev`, on the same `workers.dev` subdomain as HundAlder (`https://hundalder-kalkylator.martin-jo-strand.workers.dev`). A custom domain is out of scope for version 1.
- **Deploys only through GitHub Actions.** Cloudflare's own "Connect to Git" integration stays off for this Worker, as for HundAlder, to avoid double deploys.
- **Production gate:** every merge to `main` with green CI starts the `deploy` job, which waits in the GitHub environment `production`. The environment has `martinjostrand-bit` as required reviewer and admin bypass turned off, the same as HundAlder. To release: **Actions** → the waiting run → **Review deployments** → tick **production** → **Approve and deploy**.
- **Previews:** each pull request gets a Worker preview version (`wrangler versions upload`). The bot comments its `*.martin-jo-strand.workers.dev` URL on the PR. Preview URLs must stay enabled on the Worker.
- **Secrets:** repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under **Settings → Secrets and variables → Actions**, never in the repo. The account ID is the same as HundAlder's. Use a **new** API token for this repo, so that revoking one project's token does not break the other. Scope: _Workers Scripts:Edit_ and _Account Settings:Read_ only. HundAlder's token also has _Workers KV Storage:Edit_, which this project does not need.
- **Rollback:** `wrangler rollback`, or Cloudflare dashboard → Worker → **Deployments** → roll back to an earlier version. Then fix forward through a normal PR.
- **Privacy:** no analytics, cookies or tracking in the first version, so no cookie banner is needed.

**One-time setup (part of WP 02):** create the GitHub repo, add the two secrets, create the `production` environment with the reviewer and no admin bypass, protect `main` with `checks` and CodeQL as required checks, turn on secret scanning and push protection, and run the first deploy. The first `wrangler deploy` creates the Worker.

## 8. Non-goals and scope guardrails

Anything not listed in sections 2–7 is out of scope until this spec is updated.

**Not in version 1**

- Multiplayer or networking (the original's famous feature, but a separate project).
- Mobile/touch controls, gamepad support, key rebinding.
- Accounts, online leaderboards, any backend.
- Level editor, mods, save games mid-level.
- Game engines (Phaser etc.), UI frameworks (React etc.), state libraries, ECS frameworks.

**Rules against over-engineering** (also copied into `CLAUDE.md`)

1. Write the code the current milestone needs, nothing for "later".
2. No interface, factory, plugin system or config option with only one user.
3. Prefer plain functions and data over class hierarchies.
4. A new dependency needs a one-line reason in the PR description.
5. If a change makes the code longer without making a test pass or a bug go away, question it.
6. When in doubt, ask Martin rather than adding flexibility.

## 9. Milestones and acceptance criteria

Six milestones, each a small playable step that ends with green CI and a deploy.

1. **M0 – Skeleton.** Repo, tooling, CI, security scanning, deploy and Claude Code configuration in place; a blank canvas page is live.
   - `npm run check`, `npm test`, `npm run build` and `test:e2e` all run green in CI, and CodeQL runs on PRs.
   - Unit: the verifier hook allows the four checks and read-only `git`, and blocks writes, redirection and other commands.
   - `https://snipes-web.martin-jo-strand.workers.dev` shows the title text and version number after an approved production deploy.
   - A test PR gets a preview URL comment.
2. **M1 – Maze and movement.** Seeded maze generation, scrolling view, wrap-around, player moving in 8 directions.
   - Unit: every open cell reachable for 1,000 random seeds.
   - Unit: player cannot enter a wall; wraps correctly at all four edges.
3. **M2 – Shooting.** Bullets in 8 directions, independent of movement; stop at walls.
   - Unit: a bullet fired along a corridor stops at the first wall.
4. **M3 – Hives and snipes.** Hives spawn snipes and ghosts; snipes chase and shoot, ghosts pass through walls and cut the player off; player can kill all three and can die.
   - Simulation: with a scripted "stand still" input the player eventually dies.
   - Unit: a hive survives 19 hits, is destroyed by the 20th, then stops spawning. A ghost moves through a wall; a snipe does not.
5. **M4 – Game flow.** Lives, levels, scoring, HUD, all screens, pause, local high score, sound.
   - E2E: start → lose all lives → game over → restart works by keyboard only.
   - E2E: high score survives a page reload.
6. **M5 – Options and polish.** All four letter features (ghosts, bouncy diagonal shots, deadly walls, destroyable walls), the 1–9 table, skill-level entry on the title screen.
   - Unit: each option changes only the behaviour it names (tests with option on and off).
   - Manual: Martin plays a full game on each option and signs off in the release PR.

Version 1.0.0 is tagged after M5.

### 9.1 Work packages

The milestones split into 18 work packages. Each package is one branch, one pull request and roughly one Claude Code session, small enough to review in one sitting. Size: S ≈ half a day, M ≈ a day.

| WP  | Milestone | Scope                                                                                                                                                                                                                                                                                    | Tests written first                                                                                                                                   | Depends on | Size |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- |
| 01  | M0        | Vite + TypeScript strict, ESLint (type-checked, `--max-warnings 0`, incl. ban on `Math.random`/`Date.now` in `core/`), Prettier, Vitest with coverage thresholds, npm scripts, `.editorconfig`, `.gitattributes`, `.gitignore`, `README.md`, `SPEC.md`, `CLAUDE.md` (commands and rules) | `check`, `test`, `build` run green; a lint warning fails `check`                                                                                      | –          | S    |
| 02  | M0        | `wrangler.jsonc`, GitHub Actions workflows (checks with `npm audit`, PR preview, gated production deploy, CodeQL; see 5.4 and 7), one-time GitHub/Cloudflare setup, branch protection with both required checks, secret scanning and push protection, Dependabot, Playwright setup       | E2E: production URL shows title and version; PR gets a preview URL and a CodeQL result                                                                | 01         | S    |
| 03  | M0        | Claude Code configuration (5.7): `CLAUDE.md` roles and definition of done, `.claude/settings.json`, agents `test-writer`, `developer`, `verifier`, `spec-reviewer`, skills `/implement-wp`, `/verify`, `/ci-status`, `/release`, verifier hook                                           | Unit: the hook allows the four checks and read-only `git` and blocks everything else; `/verify` on a trivial change gives a verdict in the 6.3 format | 02         | M    |
| 04  | M1        | Seeded PRNG, cell/grid types, wrap-around coordinates, `GameState`, empty `step()`                                                                                                                                                                                                       | Same seed → same numbers; wrap math at all four edges                                                                                                 | 03         | S    |
| 05  | M1        | Seeded maze generation                                                                                                                                                                                                                                                                   | All open cells reachable for 1,000 seeds; same seed → same maze                                                                                       | 04         | M    |
| 06  | M1        | Keyboard → `InputState`; player movement in 8 directions, Space = faster, walls block                                                                                                                                                                                                    | Cannot enter walls; diagonals; wrap-around; speed                                                                                                     | 05         | M    |
| 07  | M1        | Canvas renderer, integer scaling, scrolling view centred on player, fixed-tick loop                                                                                                                                                                                                      | E2E: page renders; arrow key moves player                                                                                                             | 06         | M    |
| 08  | M2        | Bullets in 8 directions, independent of movement; stop at first wall or entity                                                                                                                                                                                                           | Bullet stops at first wall; fire while moving another way                                                                                             | 06         | S    |
| 09  | M3        | Hives: placement, 20 hits with colour stages, continuous spawning under the enemy cap                                                                                                                                                                                                    | 19 hits survive, 20th destroys; spawning stops; cap never exceeded                                                                                    | 08         | M    |
| 10  | M3        | Snipes: chase movement, line-of-sight firing, one-hit kill                                                                                                                                                                                                                               | Snipe never enters a wall; fires only with line of sight                                                                                              | 09         | M    |
| 11  | M3        | Player death (enemy, enemy bullet), lives, safe respawn                                                                                                                                                                                                                                  | Simulation: standing still eventually dies; lives decrease by one                                                                                     | 10         | S    |
| 12  | M4        | Win condition, scoring table, level bonus, digit table (hives, max enemies)                                                                                                                                                                                                              | Cleared only when nothing hostile remains; points per event; digit values                                                                             | 11         | S    |
| 13  | M4        | Screens (title with skill-level entry, pause, cleared, game over), HUD, high score per skill level                                                                                                                                                                                       | E2E: start → game over → restart by keyboard; high score survives reload                                                                              | 07, 12     | M    |
| 14  | M4        | Web Audio beeps, M = mute                                                                                                                                                                                                                                                                | E2E: mute toggles without errors                                                                                                                      | 13         | S    |
| 15  | M5        | Letter → feature lookup table; ghosts (through walls, intercepting the player)                                                                                                                                                                                                           | Each letter enables exactly its features; ghost passes walls, snipe does not                                                                          | 12         | M    |
| 16  | M5        | Bouncy diagonal shots; destroyable walls                                                                                                                                                                                                                                                 | Only diagonal shots bounce; hit wall segment removed only when flag on                                                                                | 15         | M    |
| 17  | M5        | Deadly (electrified) walls                                                                                                                                                                                                                                                               | Touching a wall kills only when flag on                                                                                                               | 15         | S    |
| 18  | M5        | Tuning, replay/determinism check, manual play checklist, `CHANGELOG.md`, tag v1.0.0                                                                                                                                                                                                      | Determinism test over recorded games; full suite green                                                                                                | all        | S    |

WP 14 can run alongside WP 15–17, and WP 16 alongside WP 17. Everything else follows the order above. WP 01–03 are set up by hand with Claude Code, because the loop below needs them to exist; from WP 04 on, every package runs through `/implement-wp`.

### 9.2 How each work package runs

`/implement-wp <WP>` runs steps 1–3 for one work package, after checking that the working tree is clean and the package's dependencies are done.

1. **Tests.** The `test-writer` reads this spec and writes the package's tests in `tests/`. They fail at first. Commit on the package branch.
2. **Implement → verify → fix**, at most 3 verification rounds:
   1. The `developer` writes the code until the tests pass. In later rounds it gets the verifier's findings exactly as written. If it thinks a finding is wrong, or the spec is unclear, the loop stops and asks Martin.
   2. `/verify <WP>` starts a new `verifier` (6.3).
   3. PASS → step 3. FAIL or INVALID with rounds left → back to 2.1. FAIL or INVALID after round 3 → stop, leave the change uncommitted and report the remaining findings to Martin.

   Nobody edits the code between rounds outside the `developer`.

3. **Commit and PR.** Commit exactly what was verified, with the trailer `Verified: PASS`, push the branch and open the pull request. `/ci-status` reports the result: `checks` and CodeQL must be green, and the preview URL is commented on the PR.
4. **Review.** Martin reads the diff and the verdict, plays the preview for a few minutes and merges.
5. **Deploy.** Martin approves the waiting `deploy` job in GitHub Actions, and the change goes live.

A package that grows beyond its size is split rather than stretched.

## 10. Open questions

- [x] ~~Which GitHub account name and which hosting service did the earlier projects use?~~ Answered from HundAlder: GitHub `martinjostrand-bit`, Cloudflare Workers via GitHub Actions (sections 5.1, 5.4, 7).
- [x] ~~Version format: keep semver or match HundAlder's `XX.YY.ZZ`?~~ Decided (Nov 8): keep plain semver on the title screen (5.5).
- [x] ~~Should the Worker name wait for the public release name?~~ Decided (Nov 8): use `snipes-web` for now. A rename after the release-name decision changes the `workers.dev` URL.
- [ ] Confirm original rules marked _(verify)_: whether ghosts shoot, whether bounced shots can hit the player, what follows a cleared level. Hive 20 hits and point values come from Martin's description; no source found yet. Reference: the reverse-engineered [Snipes source on GitHub](https://github.com/Davidebyzero/Snipes), used for behaviour only, never copied.
- [ ] Exact maze size and screen view size (original was 80×25 text mode).
- [ ] Name for public release: "Snipes" belongs to SuperSet Software; a different title (e.g. "Snipe Hunt") may be safer.
- [ ] License for our own code (MIT suggested; MissingFiles uses MIT).

## 11. Decisions log

Decisions are recorded here with their date when they are made, as in MissingFiles.

| Date       | Decision                                                                                                                                                                                              | Ref      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 2026-11-08 | GitHub account `martinjostrand-bit`; public repo; protected `main` with pull requests                                                                                                                 | 5.1      |
| 2026-11-08 | Hosting on Cloudflare Workers via GitHub Actions, with PR previews and an approval gate for production, as in HundAlder                                                                               | 5.4, 7   |
| 2026-11-08 | Plain semver, defined only in `package.json`                                                                                                                                                          | 5.5      |
| 2026-11-08 | Worker name `snipes-web` until the public release name is decided                                                                                                                                     | 7, 10    |
| 2026-11-08 | Build and quality rules adopted from MissingFiles: warnings are errors, enforced coverage, CodeQL and `npm audit`, least-privilege CI                                                                 | 5.4, 5.6 |
| 2026-11-08 | Claude Code configuration in the repository; independent, read-only verifier; `Verified: PASS` commit trailer                                                                                         | 5.7, 6.3 |
| 2026-11-08 | Unlike MissingFiles, verified changes go through pull requests, not straight to `main`                                                                                                                | 5.7, 9.2 |
| 2026-11-08 | LF line endings (MissingFiles uses CRLF because it is Windows-only)                                                                                                                                   | 5.6      |
| 2026-11-08 | Not adopted from MissingFiles: a CI build number in the version, a packaging script and release zip (the site is deployed, not downloaded), and a nightly performance workflow until a test needs one | 5.5, 5.6 |

## Sources

- [snipes(6) manual page](https://manpath.be/f29/6/snipes) – controls, letter feature chart, hives and max enemies per digit (from-scratch remake of the Novell version)
- [Snipes cheats – Cyberly](https://www.cyberly.org/game-cheats/pc/snipes.html) – skill level A1–Z9 description
- [Snipes (video game) – Wikipedia](<https://en.wikipedia.org/wiki/Snipes_(video_game)>)
- [Snipes – Lutris](https://lutris.net/games/snipes/) – win condition: all generators and snipes destroyed
- [Novell and the computer game that changed networking – Network World](https://www.networkworld.com/article/2297960/novell-and-the-computer-game-that-changed-networking.html)
- [Snipes – Giant Bomb](https://www.giantbomb.com/snipes/3030-12025/)
