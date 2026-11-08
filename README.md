# Snipes Web

A single-player browser remake of Snipes, the 1982 text-mode maze shooter. Original code and graphics; only the gameplay is recreated. See [SPEC.md](SPEC.md) for the full specification.

> Status: WP 01 (project skeleton) is done. Deploy (WP 02) and the Claude Code configuration (WP 03) are next.

## Requirements

- Node 24 (see `.nvmrc`)

## Run, check, test, build

```sh
npm ci            # install exact versions from the lockfile
npm run dev       # dev server with hot reload
npm run check     # type check, lint (warnings are errors), format check
npm test          # unit and simulation tests with coverage
npm run build     # production build to dist/
```

`npm test` fails if line coverage of `src/core/` is below 90 %. ESLint forbids `Math.random` and `Date.now` in `src/core/`, so the game stays deterministic.

## Layout

| Path          | Purpose                                         |
| ------------- | ----------------------------------------------- |
| `src/core/`   | Pure game logic (from WP 04)                    |
| `src/main.ts` | Entry point; draws the title and version for M0 |
| `tests/unit/` | Unit tests                                      |
| `SPEC.md`     | Specification                                   |
