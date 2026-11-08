# Snipes Web

Single-player browser remake of the 1982 maze shooter Snipes, in TypeScript with no runtime dependencies.

`SPEC.md` is the source of truth for rules, architecture, work packages (9.1) and decisions (11). Refer to it by section number and do not repeat it here. If code and spec disagree, raise it with Martin instead of choosing silently.

## Commands

```sh
npm run dev       # local dev server
npm run check     # tsc + ESLint (warnings are errors) + Prettier check
npm test          # Vitest unit + simulation tests, coverage threshold on src/core
npm run build     # production build to dist/
```

## Conventions

- `src/core/` is pure game logic: no DOM, no timers, no `Math.random` or `Date.now` (lint-enforced, spec 4.3). It never imports from `render/` or `input/`.
- The version is only in `package.json` `version` (spec 5.5).
- Tests name the spec section they check, e.g. `describe("2.3 Hives", …)`.
- LF line endings everywhere. Never commit `node_modules/`, `dist/` or `coverage/`.

## Rules against over-engineering (spec 8)

1. Write the code the current milestone needs, nothing for "later".
2. No interface, factory, plugin system or config option with only one user.
3. Prefer plain functions and data over class hierarchies.
4. A new dependency needs a one-line reason in the PR description.
5. If a change makes the code longer without making a test pass or a bug go away, question it.
6. When in doubt, ask Martin rather than adding flexibility.
