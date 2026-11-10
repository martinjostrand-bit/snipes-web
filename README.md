# Snipes Web

A single-player browser remake of Snipes, the 1982 text-mode maze shooter. Original code and graphics; only the gameplay is recreated. See [SPEC.md](SPEC.md) for the full specification.

> Status: M0 (skeleton) and M1 (maze and movement) are done. The game shows a random maze that scrolls with the player, who moves with the arrow keys (Space = faster). M2 (shooting) is next, starting with WP 08.

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

`npm test` fails if line coverage of `src/core/` is below 90 %. ESLint forbids `Math.random` and `Date.now` in `src/core/`, so the game stays deterministic.

## CI and deploy

The site is an assets-only Cloudflare Worker (`wrangler.jsonc`), deployed by GitHub Actions only. Cloudflare's own Git integration is off.

- **Pull request to `main`:** `checks` runs audit, check, tests, build, e2e and a Wrangler dry run. CodeQL scans the code. `preview` uploads a preview version and comments its URL on the PR. `checks` and CodeQL must pass before merging.
- **Merge to `main`:** `checks` runs again, then `deploy` waits for approval, deploys the tested `dist/` and smoke-tests the production URL.

To approve a production deploy: **Actions** → the waiting run → **Review deployments** → tick **production** → **Approve and deploy**. There is no admin bypass.

Secrets (**Settings → Secrets and variables → Actions**): `CLOUDFLARE_API_TOKEN` (_Workers Scripts:Edit_ and _Account Settings:Read_ only) and `CLOUDFLARE_ACCOUNT_ID`.

To roll back: `npx wrangler rollback`, or Cloudflare dashboard → Worker → **Deployments**.

## Layout

| Path          | Purpose                                                            |
| ------------- | ------------------------------------------------------------------ |
| `src/core/`   | Pure game logic (from WP 04)                                       |
| `src/input/`  | Maps the keys held to an `InputState` (WP 06)                      |
| `src/render/` | Draws the view around the player and the title and version (WP 07) |
| `src/main.ts` | Entry point; wires the layers and runs the loop                    |
| `tests/unit/` | Unit tests                                                         |
| `tests/e2e/`  | Playwright tests                                                   |
| `.github/`    | Workflows and Dependabot                                           |
| `SPEC.md`     | Specification                                                      |
