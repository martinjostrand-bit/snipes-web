# Snipes Web

A single-player browser remake of Snipes, the 1982 text-mode maze shooter. Original code and graphics; only the gameplay is recreated. See [SPEC.md](SPEC.md) for the full specification.

> Status: M0 (skeleton), M1 (maze and movement) and M2 (shooting) are done. The game shows a random 256 × 240 maze of 15 × 11 corridors that scrolls with the player, a 4 × 4 spacecraft that moves with the arrow keys (Space = faster) and fires with W A S D in 8 directions, diagonally with two keys held, but not while Space is held; shots fly to the first wall and disappear. M3 (hives and snipes) is under way: hives, 3 to 10 by the skill digit, sit at random spots, change colour as they take hits, break on the 20th and spawn snipes every 2 seconds up to the digit's maximum. Snipes do not move or shoot yet (WP 10). Every game starts at skill level A1 until the title screen (WP 13).

**Live:** https://snipes-web.martin-jo-strand.workers.dev

## Requirements

- Node 24 (see `.nvmrc`)

## Run, check, test, build

```sh
npm ci            # install exact versions from the lockfile
npm run dev       # dev server with hot reload
npm run check     # type check, lint (warnings are errors), format check
npm test          # unit and simulation tests with coverage
npm run build     # production build to dist/
npm run test:e2e  # build, then Playwright tests in Chromium, Firefox and WebKit
```

Install the Playwright browsers once with `npx playwright install`.

To replay a known maze, open the page with `?seed=N`, a whole number from 0 to 4294967295 (for example `http://localhost:5173/?seed=42`). Without it, or with any other value, each game gets a random seed.

`npm test` fails if line coverage of `src/core/` is below 90 %. ESLint forbids `Math.random` and `Date.now` in `src/core/`, so the game stays deterministic.

## CI and deploy

The site is an assets-only Cloudflare Worker (`wrangler.jsonc`), deployed by GitHub Actions only. Cloudflare's own Git integration is off.

- **Pull request to `main`:** `checks` runs audit, check, tests, build, e2e and a Wrangler dry run. CodeQL scans the code. `preview` uploads a preview version and comments its URL on the PR. `checks` and CodeQL must pass before merging.
- **Merge to `main`:** verified PRs merge automatically once `checks` and CodeQL are green. On `main`, `checks` runs again and `preview` uploads a staging preview, whose URL is in the run summary. Nothing is deployed.
- **Release tag `v*`** (pushed by `/release`, once per milestone): `checks` runs, then `deploy` waits for approval, deploys the tested `dist/` and smoke-tests the production URL.

To approve a production deploy: **Actions** → the waiting run → **Review deployments** → tick **production** → **Approve and deploy**. There is no admin bypass.

Secrets (**Settings → Secrets and variables → Actions**): `CLOUDFLARE_API_TOKEN` (_Workers Scripts:Edit_ and _Account Settings:Read_ only) and `CLOUDFLARE_ACCOUNT_ID`.

To roll back: `npx wrangler rollback`, or Cloudflare dashboard → Worker → **Deployments**.

## Layout

| Path          | Purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `src/core/`   | Pure game logic (from WP 04)                                            |
| `src/input/`  | Maps the keys held to an `InputState` (WP 06)                           |
| `src/render/` | Draws the view around the player and the title and version (WP 07, 07b) |
| `src/main.ts` | Entry point; wires the layers and runs the loop                         |
| `tests/unit/` | Unit tests                                                              |
| `tests/e2e/`  | Playwright tests                                                        |
| `.github/`    | Workflows and Dependabot                                                |
| `SPEC.md`     | Specification                                                           |
