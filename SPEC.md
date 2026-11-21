# Snipes Web — Specification

Nov 21, 2026 · @Martin · Draft v0.12

- v0.2: sections 5 and 7 filled in from the HundAlder project's GitHub and publishing setup.
- v0.3: CI, build and quality principles adopted from the MissingFiles project (5.2–5.7, 6.3–6.4, 9, 11).
- v0.4: movement against walls, corner gaps, opposite keys and touching a deadly wall (2.1, 2.2, 2.8, 6.2, 9, 10, 11).
- v0.5: relative sizes of entities, corridors and walls, on a grid of square character cells; new WP 07b (2.10, 3, 6.2, 6.3, 9, 9.1, 10, 11).
- v0.6: a diagonal shot at a corner gap stops (2.10, 10, 11).
- v0.7: PRs merge automatically once verified and green; production deploys only on a release tag, one release per milestone, with a staging preview of `main` (5.1, 5.4, 5.5, 5.6, 5.7, 6.3, 7, 9, 9.1, 9.2, 11).
- v0.8: speeds and the letter and digit tables from the original's reverse-engineered source; 60 ticks/s; bouncing shots; destroyable walls dropped; new WP 08b (2.2, 2.5, 2.6, 2.9, 2.10, 4.3, 9, 9.1, 10, 11).
- v0.9: optional `?seed=N` in the page URL; the 6.3 exception covers test setup that a new feature changes; WP 09 also draws hives and snipes (4.3, 6.3, 9.1, 11).
- v0.10: snipe movement, aim and accuracy from the original (2.4, 2.6, 2.7, 9.1, 10, 11).
- v0.11: hives count like walls in a snipe's corner-gap test (2.4, 11).
- v0.12: when the player dies within a tick, and what a safe respawn spot is (2.2, 2.4, 11).

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

The game is a grid-based maze shooter: clear every hive and every snipe on a level to win it; lose all lives and the game ends. Rules marked _(verify)_ should be checked against the original (see Open questions); until then they may be implemented as written, and a later correction is a spec change.

### 2.1 Maze

- A rectangular grid of cells, larger than the screen. The view scrolls to keep the player centred.
- The maze **wraps around** at all four edges.
- A new maze is **generated randomly** from a seed for every game. The same seed always gives the same maze.
- Every open cell must be reachable from every other open cell by straight steps (up, down, left, right, with wrap-around).
- Walls are solid for the player, snipes and bullets; ghosts pass through them (2.4).
- **No corner gaps:** nothing that walls block (the player, snipes and bullets) moves diagonally between two walls that touch at a corner, that is, when both straight neighbours on the way (the horizontal one and the vertical one) are walls, even if the diagonal cell is open. Neighbours are found with wrap-around. Ghosts pass through walls and are not affected. _(verify)_

### 2.2 Player

- Moves one cell at a time in **8 directions**: diagonal by holding one vertical and one horizontal key.
- **Speed:** one step every 3 ticks (20 cells/s) normally, and every 2 ticks (30 cells/s) while **Space** is held (4.3). The original moved 18.2 and 36.4 cells/s at our scale (2.10); these values keep an even rhythm on a 60 Hz screen. A step happens on the first tick a direction is held and the previous wait is over; after a step the player waits 2 more ticks, or 1 if Space was held at that step.
- Movement and shooting are **independent**: the player can move one way and fire another. The one exception, as in the original: no shot is fired while Space is held.
- Walls block the player, snipes and bullets (ghosts excepted).
- **Diagonal moves slide along walls.** Moving diagonally, the player takes the first of these that is possible: _(verify)_
  1. the diagonal step, if the diagonal cell is open and at least one of the two straight neighbours on the way is open (2.1, no corner gaps);
  2. one cell in the held horizontal direction, if that cell is open;
  3. one cell in the held vertical direction, if that cell is open.

  Otherwise it stays put. Each of these is one normal step at the current speed, and neighbours are found with wrap-around. Staying put does not use up a step.

- Has a limited number of lives, set by the digit (2.6). On death the player loses a life, is out of play (not drawn, cannot move, fire, be hit or touch anything) and respawns at a safe spot after a short delay.
- **Safe spot:** a block's start position (2.10) whose block has no hive cell, where no snipe and no snipe shot overlaps that block or any of the 8 blocks around it (with wrap-around). The blocks are tried farthest from the block where the player died first (by the wrapped distance |Δcolumn| + |Δrow| in blocks; ties by row, then column). If no block qualifies, the player tries again on the next tick.
- **Instant death** on touching an enemy, being hit by an enemy bullet, or touching a wall when deadly walls are on (see 2.6).
- **Touching a wall** means that a held movement direction would take the player into a wall cell: a straight step into a wall, or a diagonal whose diagonal cell is a wall. With deadly walls on, this kills the player and no slide happens. Passing next to a wall is not touching it. _(verify)_

### 2.3 Hives (generators)

- Placed at random open spots when the level starts. Count is set by the skill digit (2.6).
- Animate (flash) so they are easy to spot.
- **Spawn continuously** while alive: a new snipe (or ghost, if enabled) at a fixed interval, as long as the number of enemies on the map is below the digit's maximum.
- **Withstand 20 hits.** The hive changes colour as it takes damage, so the player can see how close it is to breaking.
- On the 20th hit the hive is destroyed and stops spawning. Enemies it already spawned stay.

### 2.4 Snipes and ghosts

Hives spawn two kinds of enemy. Both die from **one hit**.

|              | Snipe                                                                        | Ghost                                                               |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Walls        | Blocked, moves through corridors                                             | **Passes through walls**                                            |
| Movement     | Chases the player with some randomness (see below)                           | Aggressive: heads straight for the player and tries to cut them off |
| Attack       | Fires along its moving direction at the player (see below); kills on contact | Kills on contact; does not shoot _(verify)_                         |
| Hits to kill | 1                                                                            | 1                                                                   |
| Points       | 10                                                                           | 10                                                                  |

Ghosts appear only when the skill letter enables them (2.6). "Creep" in some descriptions is another name for a snipe, not a third enemy type.

**How a snipe moves and fires**, as in the original (its reverse-engineered source, section 10).

- **Distances** are measured with wrap-around, from the snipe's position to the player's (top-left cells, 2.10): dx and dy are the shortest signed distances (exactly half the maze counts as positive), and D = |dx| + |dy|.
- **Random draws** come from the game's PRNG, one `nextFloat` value each, in the order given here. A chance p succeeds when the value is below p; "a random one of n" is item ⌊value × n⌋ of a list in a fixed order. Nothing is drawn that this text does not name.
- **Direction to the player**, the first that applies: if |dx| < 2, up when dy < 0, else down; if |dy| < 2, left when dx < 0, else right; otherwise the diagonal toward the player.
- **A new snipe** draws its direction (a random one of the 8), then its turning sense (a random one of clockwise and anticlockwise), which it keeps. It takes its first step on the tick after it appears.
- **Open for a snipe** means its 4 × 2 footprint covers no wall and no hive cell, and the step is not a diagonal through a corner gap (2.1, 2.10). For a snipe, a straight position on the way counts as blocked when it covers a wall or a hive cell, so it cannot squeeze diagonally between a hive and a wall or between two hives. Snipes may overlap each other and the player.
- **Steps:** a snipe steps when its wait is over: 10 ticks after a straight step and 13 after a diagonal one (about 6 and 4.6 cells/s). Each step:
  1. It draws the keep chance, 3/4. On success it tries its current direction, and moves if that position is open.
  2. If the keep chance failed, or the position was blocked, it draws the random-turn chance, 1/4. On success it draws a random one of the 8 directions; otherwise it takes the direction to the player. It then tries up to 8 directions, starting with that one and turning one-eighth of a turn in its turning sense after each blocked try, and moves in the first open one, which becomes its direction. If all 8 are blocked it stays put, keeps the last direction tried and waits as after a straight step.
- **Firing:** after each step (also one where it stays put), measured from its new position, if the direction to the player equals the snipe's direction (for a diagonal, also |(|dx| − |dy|)| < 4) and s = ⌊D / 2^(accuracy + 1)⌋ is at most 10, it draws the fire chance, 1 / 2^(s + 1). Accuracy comes from the letter (2.6). On success it fires one shot in its direction, unless the shot's start position covers a wall, in which case nothing appears. Walls between it and the player don't stop it firing; they stop the shot.
- **Its shot** is 2 × 2 and appears just outside its footprint in the firing direction: straight up or down over its middle two columns, straight left or right over its two rows, diagonally touching the matching corner. It moves one cell per tick like the player's and stops at the first wall or corner gap (2.5, 2.10). It never bounces. It kills the player (2.2), damages hives and kills snipes and ghosts (2.5).
- **Hit by the player's shot:** a snipe dies from one hit (one cell of overlap, 2.10) and the shot disappears.
- **Order within a tick** (4.3): shots move and hits are resolved; hives spawn; the player moves; snipes step and fire, in the order they appeared; the player fires. A shot first moves on the tick after it appears. A player hit by a shot in the first stage is out of play at once and does not move that tick. Touching a snipe is checked after the player moves and again after the snipes step; an overlap at either point kills the player, even if it is gone by the end of the tick.

### 2.5 Bullets

- Fired in **8 directions** (W A S D, diagonal by holding two keys), independent of movement.
- Travel in a straight line at one cell per tick (60 cells/s), faster than any creature, until they hit an entity or a wall.
- **Fire rate:** the player's shot fires on any tick a fire key is held and at least 13 ticks have passed since the last shot (about 4.6 shots/s; the original's is about 4.55). Tapping cannot fire faster. If the shot's start position (2.10) is a wall, no shot is fired and no time is used.
- By default a bullet that hits a wall disappears and the wall is unharmed.
- **Bouncing shots** (letter feature, 2.6): only the player's _diagonal_ shots bounce; straight shots and snipe shots always stop at walls. When a bouncing shot is fired it draws N, uniformly from 1 to 8, from the game's PRNG; no draw happens for straight shots or with the feature off. When its next diagonal step is blocked (the 2.10 footprint test), it bounces instead of stopping, as long as it has bounces left:
  - only the horizontal straight position blocked: its horizontal direction reverses;
  - only the vertical straight position blocked: its vertical direction reverses;
  - both blocked (a corner or corner gap), or neither (the end of a wall): both directions reverse, and it comes back the way it came.

  A bounce uses that tick's move and one of its N bounces. With none left it stops at the next wall. A bounced shot can hit the player, including the player's own shot, and kills the player.

- A snipe's shot that hits a hive damages it like the player's shot, unless the letter makes hives resist snipe shots (2.6). A hive destroyed this way counts toward clearing the level but gives no points. As in the original, a snipe's shot also kills a snipe or ghost it hits, with no points.

### 2.6 Skill level: letter A–Z + digit 1–9

Before a game the player enters a skill level such as `A1` or `M5`. The **letter** switches rule features on or off; the **digit** sets how many hives, enemies and lives there are. All three tables are the original's, from its reverse-engineered source (section 10).

**Letter = which features are on.** The letters are combinations, not a smooth difficulty ramp: A to C have no features, Z has all of them.

| Feature                    | Enabled for letters |
| -------------------------- | ------------------- |
| Ghosts                     | D–F, I–L, O, P, S–Z |
| Bouncing diagonal shots    | G–L, Q–Z            |
| Deadly (electrified) walls | M–Z                 |
| Hives resist snipe shots   | W–Z                 |

**Snipe accuracy by letter** (2.4; higher means it fires from further away):

| Letter   | A   | B   | C   | D   | E   | F   | G   | H   | I   | J   | K   | L   | M   | N   | O   | P   | Q   | R   | S   | T   | U   | V   | W   | X   | Y   | Z   |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Accuracy | 2   | 3   | 4   | 3   | 4   | 4   | 3   | 4   | 3   | 4   | 4   | 5   | 3   | 4   | 3   | 4   | 3   | 4   | 3   | 4   | 4   | 5   | 4   | 4   | 5   | 5   |

**Digit = hives, enemy density and lives.**

| Digit              | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   |
| ------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hives              | 3   | 3   | 4   | 4   | 5   | 5   | 6   | 8   | 10  |
| Max enemies on map | 10  | 20  | 30  | 40  | 60  | 80  | 100 | 120 | 150 |
| Lives              | 5   | 5   | 5   | 5   | 5   | 4   | 4   | 3   | 2   |

The letter-to-feature mapping lives in one small lookup table in `core/`. The original also varies how often ghosts burst by letter; see section 10.

### 2.7 Levels and scoring

- **Primary goal:** destroy every hive, which stops new enemies.
- **Secondary goal:** kill every remaining snipe and ghost. The level is cleared only when no hive and no enemy is left.

| Event          | Points                                                 |
| -------------- | ------------------------------------------------------ |
| Hive destroyed | 100                                                    |
| Snipe killed   | 10                                                     |
| Ghost killed   | 10                                                     |
| Level cleared  | Bonus from lives left and time taken (formula tunable) |

- Enemy speed does not depend on the letter. A snipe's chance to fire does, through its accuracy (2.4, 2.6).
- The best score per skill level is stored locally in the browser.

### 2.8 Controls

| Action      | Keys                                  |
| ----------- | ------------------------------------- |
| Move        | Arrow keys (diagonal = two keys held) |
| Move faster | Hold Space                            |
| Fire        | W A S D (diagonal = two keys held)    |
| Pause       | P or Esc                              |
| Restart     | R (from the game-over screen)         |

Holding two opposite keys of the same group (Left+Right, Up+Down, A+D, W+S) cancels that axis; the other axis still works. Holding all four keys of a group does nothing. _(verify)_

Keys are rebindable later only if asked for; the first version has fixed keys. Gamepad and touch are out of scope.

### 2.9 Verification notes

Martin's description (7 Nov) was checked against the snipes(6) manual and a cheat-code page. Where they differ, the spec follows the sources:

| Topic                | Description said                          | Sources say                                   | Spec now            |
| -------------------- | ----------------------------------------- | --------------------------------------------- | ------------------- |
| Directions           | 4 for moving and firing                   | Diagonals by holding two keys                 | 8 directions        |
| Letter A–Z           | Gradual ramp: slow → fast enemies         | Four on/off features in combinations          | Feature table (2.6) |
| Digit 1–9            | Hives (3–5 at level 1) + density          | 3/4/5 hives, 10–150 max enemies               | Digit table (2.6)   |
| Wall damage          | Only electrified walls can be neutralised | "Destroyable walls" is its own letter feature | Dropped (Nov 16)    |
| Bounce               | Not mentioned                             | Only diagonal shots bounce                    | Added               |
| Speed key            | Not mentioned                             | Space moves faster                            | Added               |
| Points, hive 20 hits | 100/10/10, 20 hits                        | Original's points differ; 20 hits not found   | Kept, open (10)     |

On Nov 16 the letter and digit tables, speeds, bouncing and fire rate were checked against the original's reverse-engineered source. The letter and digit tables before v0.8 came from snipes(6), a later remake, and were replaced: the original has no destroyable walls, different letters for each feature, more hives at high digits and fewer lives at digits 6 to 9.

### 2.10 Sizes

The original was drawn with text characters in 40-column text mode, where characters are almost square. The game keeps its proportions at **twice the original's scale**, except that walls stay 1 cell thick. The grid in 2.1 is a grid of **square character cells**. Every entity covers a rectangle of cells, its **footprint**. Sizes are columns × rows.

| Item     | Footprint | Original  | Notes                                                        |
| -------- | --------- | --------- | ------------------------------------------------------------ |
| Player   | 4 × 4     | 2 × 2     | Its position is its top-left cell, as for every entity       |
| Shot     | 2 × 2     | 1 × 1     | Player and enemy shots alike                                 |
| Snipe    | 4 × 2     | 2 × 1     | Always horizontal; only the drawing turns with its direction |
| Ghost    | 2 × 2     | 1 × 1     |                                                              |
| Hive     | 4 × 4     | 2 × 2     |                                                              |
| Corridor | 15 × 11   | 7 × 5     | Open cells between walls: 15 wide, 11 high                   |
| Wall     | 1 thick   | 1         |                                                              |
| Maze     | 256 × 240 | 128 × 120 | 16 × 20 blocks of 16 × 12 cells (15 open + 1 wall each way)  |

Source: the reverse-engineered Snipes source (section 10), `Snipes.h` and its sprite table, read for the numbers only.

- The maze is a grid of 16 × 20 blocks. Each block is 16 cells wide and 12 high: 15 × 11 open cells, with a 1-cell wall on its left and top side where the maze has one. Corridors keep this width everywhere, including across the maze edges.
- The rules in 2.1, 2.2 and 6.2 that speak of "a cell" apply to the **whole footprint**. A position is open when every cell of the footprint is open, with wrap-around. A step moves the footprint one cell.
- **Reachability (2.1):** every position where the player's footprint fits can be reached from every other by straight steps.
- **Corner gaps and slides (2.1, 2.2):** a diagonal step needs the footprint at the diagonal position to be open and the footprint at at least one of the two straight positions to be open. Otherwise the slide order in 2.2 applies, each step tested with the whole footprint.
- **Shots at corner gaps (2.1, 2.5):** a diagonal shot uses the same test with its 2 × 2 footprint. With bouncing on and bounces left, it bounces instead (2.5). If the diagonal position is open but both straight positions are blocked, the shot stops there as if it hit a wall: it disappears and the wall is unharmed.
- **Touching a wall (2.2):** a held direction would put a footprint cell on a wall cell.
- Ghosts' footprints may overlap walls.
- **Start and respawn (2.2):** the player starts and respawns as near the middle of a block as it can, leaning up-left: 5 cells from the left wall and 3 from the top wall (6 and 4 on the other sides).
- **Touching an enemy (2.2):** the player's footprint and the enemy's footprint overlap. Being next to each other is not touching.
- **Player shots (2.5):** a shot appears just outside the player's footprint in the firing direction. Straight up or down it covers the footprint's middle two columns; straight left or right its middle two rows. Diagonally it touches the matching corner from outside.

## 3. Presentation

The game is drawn on a single HTML `<canvas>` in a retro text-mode style: a fixed character grid, a small palette, crisp pixels.

- **Look:** inspired by the original's line-drawing characters and smiley figures, but with our own original glyphs/sprites. Monospace grid, dark background.
- **Scaling:** the canvas scales in whole-number steps to fit the window, so pixels stay sharp. Minimum supported window: 1280×720.
- **HUD:** one status line with score, lives, level, hives left and snipes left.
- **Screens:** title/options → playing → paused → level cleared → game over. Nothing else.
- **Sound:** short beeps made with the Web Audio API (shot, hit, hive destroyed, death). Mute toggle with M. No audio files.
- **Frame rate:** rendering at the display's refresh rate; game logic at a fixed tick rate (see 4.3).
- **Size:** everything is drawn at the sizes in 2.10, one square character cell per grid cell, so the proportions match the original. The player is a modern take on a bird-like spacecraft with animated space guns in 8 directions. A snipe is a snipe character with a "spear" character pointing the way it moves. Walls are drawn as double solid lines. The player's guns point in the last firing direction.
- **View:** 80 × 44 cells of the maze plus the HUD row, at 8 × 8 px per cell (640×360, shown at ×2 in a 1280×720 window). The player's footprint is centred in the view.

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

- Logic runs at a **fixed tick** of 60 ticks/s, in step with a 60 Hz screen, via an accumulator loop; rendering runs on `requestAnimationFrame`.
- The core exposes one main function: `step(state, input) → state`. No other way to change game state.
- All randomness comes from a **seeded PRNG** (e.g. mulberry32) stored in the state. `Math.random()` and `Date.now()` are banned in `core/` (enforced by lint rule).
- A game is fully described by `(seed, options, input log)`. This enables replays, bug reports and simulation tests.
- The page accepts an optional `?seed=N` in its URL, a whole number from 0 to 2³² − 1; without it, or with any other value, each game gets a random seed. The e2e tests use it to start from a known maze, and it makes a bug report reproducible.

## 5. Build environment and tooling

One repository on Martin's existing GitHub account, with a small set of standard tools, all run the same way locally and in CI.

### 5.1 Repository

- Repo: `martinjostrand-bit/snipes-web`, on the same GitHub account as HundAlder (`martinjostrand-bit/hundalder-kalkylator`).
- **Public**, like HundAlder. On GitHub's free plan, branch protection and the required-reviewer gate on the `production` environment (section 7) only work on public repositories.
- Default branch `main`, protected: changes land via pull request with green CI. The repository setting **Allow auto-merge** is on, so a verified PR merges itself once its checks pass (9.2). (HundAlder uses `master` without branch protection; this project uses `main` and protects it.)
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

**`.github/workflows/deploy.yml`** is modelled on HundAlder's. It runs on every pull request to `main`, every push to `main`, every pushed release tag `v*`, and on demand (`workflow_dispatch`). It has three jobs:

| Job       | Runs on                                  | Steps                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`  | Every run                                | `npm ci` → `npm audit --audit-level=high` → `check` → `test` (with coverage) → `build` → `test:e2e` → `wrangler deploy --dry-run` → upload `dist/` as a workflow artifact. Coverage and the Playwright report are uploaded as artifacts even when a step fails. |
| `preview` | PRs and pushes to `main`, after `checks` | Download `dist/` → `wrangler versions upload` → comment the preview URL on the PR, or for `main` write it to the run summary as the staging preview                                                                                                             |
| `deploy`  | Release tags `v*` only, after `checks`   | Download `dist/` → `wrangler deploy`; runs in the `production` environment, so it waits for Martin's approval                                                                                                                                                   |

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
- There is one release per milestone. The last work package of a milestone bumps the MINOR version (M1 → 0.2.0, … M4 → 0.5.0; M5 → 1.0.0) and adds the version's section to `CHANGELOG.md`.
- Between two releases, each of MAJOR, MINOR and PATCH goes up at most once. Changes that only affect documentation, tests or CI do not change the version.
- A release is a commit on `main` with a passing CI run. `/release` (5.7) tags it `vX.Y.Z`. The tag runs `checks` and the production deploy, which waits for Martin's approval (7). Once the deploy succeeds, `/release` publishes a GitHub Release with the version's section of `CHANGELOG.md` as the notes. Merges to `main` between releases are not deployed.
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
8. **Security in the pipeline and in the repository.** The pipeline runs CodeQL, `npm audit` and Dependabot. Secret scanning and push protection are GitHub repository settings, not pipeline steps. `/release` checks that both are on before it tags a release (5.7).
9. **Slow tests move, they don't disappear.** A test that no longer fits the time budgets in 6.1 moves to a scheduled workflow, like MissingFiles' nightly performance test. It is not deleted or skipped.
10. **The spec is the source of truth.** Tests name the spec section they check, for example `describe('2.3 Hives', …)`. When code and spec disagree, raise it with Martin instead of choosing silently. If the spec is wrong, it is changed first, in its own PR.

### 5.7 Claude Code configuration

Claude Code is the development tool. Its configuration is in the repository, so every session works the same way. This follows MissingFiles' DEV-01 to DEV-07, adapted to pull requests.

| File                                   | Content                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                            | Commands, conventions, the roles below, the definition of done, and the rules in section 8. It refers to `SPEC.md` instead of repeating it.                                                                                                                                             |
| `.claude/settings.json`                | Permissions. `npm run check`, `npm test`, `npm run build`, `npm run test:e2e` read-only `git` and `gh` commands, and `gh pr merge --auto --merge` (9.2 step 3) run without a prompt. `git push --force` and `git reset --hard` are denied. `gh api` prompts, because it can also write. |
| `.claude/agents/`                      | The agents below                                                                                                                                                                                                                                                                        |
| `.claude/skills/`                      | The skills below                                                                                                                                                                                                                                                                        |
| `.claude/hooks/verifier-bash-guard.js` | `PreToolUse` hook. Inside the `verifier`, it allows only read-only `git` commands, simple text filters and the four check commands exactly as written, and blocks everything else.                                                                                                      |

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
3. The PR's required checks are green and it is merged. `/implement-wp` turns on auto-merge after a PASS, so GitHub merges it when the checks pass (9.2). It goes live with the next release (5.5).

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

- Every position where the player's footprint fits is reachable by straight steps; no cell covered by the player, a snipe or a bullet is ever a wall (ghosts may be) (2.10).
- Corridors are 15 cells wide and 11 high, and walls 1 cell thick (2.10).
- A hive is destroyed after exactly 20 hits, never earlier or later; a destroyed hive never spawns again.
- The number of enemies never exceeds the digit's maximum; counts never go negative.
- Each letter enables exactly the features in the 2.6 table, no more.
- The same seed + input log always produces the same final state (determinism test).
- A level with zero hives, snipes and ghosts is always marked cleared.

### 6.3 Independence rules

1. **Tests first, from the spec.** For each work package, the `test-writer` writes the acceptance tests from sections 2 and 9 before the feature code.
2. **Separate roles.** Writing tests, implementing and verifying are done by different agents (5.7), each in its own context. The `developer` must not edit acceptance tests to make them pass; a test change needs its own pull request with a reason. Exceptions: when a spec change makes earlier acceptance tests wrong, or a new feature changes the setup that earlier tests need (for example new entities in `createGame`), the `test-writer` commit of the work package that implements it may replace or update them. The PR description names those tests and why (for example WP 07b and WP 09).
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
5. **Manual play check.** Before each release, Martin plays one full game on the staging preview of the release commit (5.4) and confirms the checklist in 6.4 when `/release` asks.
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
- **Production gate:** only a pushed release tag `v*` starts the `deploy` job (5.5), which waits in the GitHub environment `production`. Merges to `main` run `checks` and upload a staging preview, but do not deploy. The `deploy` job fails unless the tagged commit is on `main`. The environment has `martinjostrand-bit` as required reviewer and admin bypass turned off, the same as HundAlder. To release: **Actions** → the waiting run → **Review deployments** → tick **production** → **Approve and deploy**.
- **Previews:** each pull request and each push to `main` gets a Worker preview version (`wrangler versions upload`). For a PR the bot comments its `*.martin-jo-strand.workers.dev` URL on the PR; for `main` the URL is in the run summary (the staging preview, 6.3 rule 5). Preview URLs must stay enabled on the Worker.
- **Secrets:** repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under **Settings → Secrets and variables → Actions**, never in the repo. The account ID is the same as HundAlder's. Use a **new** API token for this repo, so that revoking one project's token does not break the other. Scope: _Workers Scripts:Edit_ and _Account Settings:Read_ only. HundAlder's token also has _Workers KV Storage:Edit_, which this project does not need.
- **Rollback:** `wrangler rollback`, or Cloudflare dashboard → Worker → **Deployments** → roll back to an earlier version. Then fix forward through a normal PR and a new release (5.5).
- **Privacy:** no analytics, cookies or tracking in the first version, so no cookie banner is needed.

**One-time setup (part of WP 02):** create the GitHub repo, add the two secrets, create the `production` environment with the reviewer, no admin bypass and deployments allowed from tags `v*`, turn on **Allow auto-merge**, protect `main` with `checks` and CodeQL as required checks, turn on secret scanning and push protection, and run the first deploy. The first `wrangler deploy` creates the Worker.

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

Six milestones, each a small playable step that ends with green CI and a release.

1. **M0 – Skeleton.** Repo, tooling, CI, security scanning, deploy and Claude Code configuration in place; a blank canvas page is live.
   - `npm run check`, `npm test`, `npm run build` and `test:e2e` all run green in CI, and CodeQL runs on PRs.
   - Unit: the verifier hook allows the four checks and read-only `git`, and blocks writes, redirection and other commands.
   - `https://snipes-web.martin-jo-strand.workers.dev` shows the title text and version number after an approved production deploy.
   - A test PR gets a preview URL comment.
2. **M1 – Maze and movement.** Seeded maze generation, scrolling view, wrap-around, player moving in 8 directions.
   - Unit: every open cell reachable for 1,000 random seeds.
   - Unit: player cannot enter a wall; wraps correctly at all four edges.
   - Unit: a diagonal into a wall slides as in 2.2; no diagonal step through a corner gap (2.1); opposite movement keys cancel (2.8).
   - Unit: corridors are 15 × 11 cells and walls 1 thick for 1,000 seeds; the player's 4 × 4 footprint never covers a wall and can reach every corridor (2.10).
3. **M2 – Shooting.** Bullets in 8 directions, independent of movement; stop at walls.
   - Unit: a bullet fired along a corridor stops at the first wall.
4. **M3 – Hives and snipes.** Hives spawn snipes and ghosts; snipes chase and shoot, ghosts pass through walls and cut the player off; player can kill all three and can die.
   - Simulation: with a scripted "stand still" input the player eventually dies.
   - Unit: a hive survives 19 hits, is destroyed by the 20th, then stops spawning. A ghost moves through a wall; a snipe does not.
5. **M4 – Game flow.** Lives, levels, scoring, HUD, all screens, pause, local high score, sound.
   - E2E: start → lose all lives → game over → restart works by keyboard only.
   - E2E: high score survives a page reload.
6. **M5 – Options and polish.** All four letter features (ghosts, bouncing diagonal shots, deadly walls, hives resisting snipe shots).
   - Unit: each option changes only the behaviour it names (tests with option on and off).
   - Manual: Martin plays a full game on each option and signs off when `/release` asks (6.3 rule 5).

Version 1.0.0 is released with `/release` after M5.

### 9.1 Work packages

The milestones split into 20 work packages. Each package is one branch, one pull request and roughly one Claude Code session, small enough to review in one sitting. Size: S ≈ half a day, M ≈ a day.

| WP  | Milestone | Scope                                                                                                                                                                                                                                                                                                                                                                   | Tests written first                                                                                                                                                                                                                                                                              | Depends on | Size |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---- |
| 01  | M0        | Vite + TypeScript strict, ESLint (type-checked, `--max-warnings 0`, incl. ban on `Math.random`/`Date.now` in `core/`), Prettier, Vitest with coverage thresholds, npm scripts, `.editorconfig`, `.gitattributes`, `.gitignore`, `README.md`, `SPEC.md`, `CLAUDE.md` (commands and rules)                                                                                | `check`, `test`, `build` run green; a lint warning fails `check`                                                                                                                                                                                                                                 | –          | S    |
| 02  | M0        | `wrangler.jsonc`, GitHub Actions workflows (checks with `npm audit`, PR preview, gated production deploy, CodeQL; see 5.4 and 7), one-time GitHub/Cloudflare setup, branch protection with both required checks, secret scanning and push protection, Dependabot, Playwright setup                                                                                      | E2E: production URL shows title and version; PR gets a preview URL and a CodeQL result                                                                                                                                                                                                           | 01         | S    |
| 03  | M0        | Claude Code configuration (5.7): `CLAUDE.md` roles and definition of done, `.claude/settings.json`, agents `test-writer`, `developer`, `verifier`, `spec-reviewer`, skills `/implement-wp`, `/verify`, `/ci-status`, `/release`, verifier hook                                                                                                                          | Unit: the hook allows the four checks and read-only `git` and blocks everything else; `/verify` on a trivial change gives a verdict in the 6.3 format                                                                                                                                            | 02         | M    |
| 04  | M1        | Seeded PRNG, cell/grid types, wrap-around coordinates, `GameState`, empty `step()`                                                                                                                                                                                                                                                                                      | Same seed → same numbers; wrap math at all four edges                                                                                                                                                                                                                                            | 03         | S    |
| 05  | M1        | Seeded maze generation                                                                                                                                                                                                                                                                                                                                                  | All open cells reachable for 1,000 seeds; same seed → same maze                                                                                                                                                                                                                                  | 04         | M    |
| 06  | M1        | Keyboard → `InputState`; player movement in 8 directions, Space = faster, walls block                                                                                                                                                                                                                                                                                   | Cannot enter walls; diagonals; diagonal into a wall slides as in 2.2; no corner gaps; opposite keys cancel; wrap-around; speed                                                                                                                                                                   | 05         | M    |
| 07  | M1        | Canvas renderer, integer scaling, scrolling view centred on player, fixed-tick loop                                                                                                                                                                                                                                                                                     | E2E: page renders; arrow key moves player                                                                                                                                                                                                                                                        | 06         | M    |
| 07b | M1        | Sizes (2.10): square character-cell grid; 256 × 240 maze of 16 × 12 blocks with 15 × 11 corridors and 1-thick walls, incl. across the edges; 4 × 4 player footprint for movement, slides, corner gaps and wrap-around; view size and renderer for character cells. Replaces the M1 tests that assume 1-cell entities and corridors                                      | Corridors 15 × 11 and walls 1 thick, every footprint position reachable, for 1,000 seeds; footprint never covers a wall; footprint slides and corner gaps; wrap at all four edges; E2E: view fits at an integer scale at 1280×720                                                                | 07         | M    |
| 08  | M2        | Bullets in 8 directions, independent of movement; stop at first wall or entity                                                                                                                                                                                                                                                                                          | Bullet stops at first wall; fire while moving another way; a shot hits an entity when it enters a cell of its footprint                                                                                                                                                                          | 07b        | S    |
| 08b | M2        | Speeds (2.2, 2.5, 4.3): logic at 60 ticks/s; the player steps every 3 ticks, every 2 with Space; shots move 1 cell per tick; holding a fire key fires every 13 ticks; no firing while Space is held. Ships in 0.3.0, as M2 is not yet released, and updates that CHANGELOG section. Replaces the WP 06–08 tests that assume 30 ticks/s and the old step and shot timing | One tick is 1/60 s; step timing normal and with Space; shot speed and fire rate; no shot while Space is held; shots still faster than the fast player                                                                                                                                            | 08         | S    |
| 09  | M3        | Hives: placement, 20 hits with colour stages, continuous spawning under the enemy cap; hive count and enemy cap from the 2.6 digit table. Hives (with their colour stages) and spawned snipes are drawn; the page reads `?seed=N` (4.3)                                                                                                                                 | 19 hits survive, 20th destroys; spawning stops; cap never exceeded; hive and spawned footprints never cover a wall                                                                                                                                                                               | 08b        | M    |
| 10  | M3        | Snipes: movement and firing as in 2.4 (accuracy by letter, 2.6), their shots, one-hit kill by the player's shot. Until WP 11, a snipe's shot that reaches the player disappears and touching does nothing                                                                                                                                                               | Snipe's footprint never covers a wall; step timing; keeps, turns and chooses directions as 2.4; fires only along its direction at an aligned player, never when s > 10; fixed PRNG draw order; hives block snipes; its shot damages hives and kills other enemies; one player shot kills a snipe | 09         | M    |
| 11  | M3        | Player death (enemy, enemy bullet), lives, safe respawn                                                                                                                                                                                                                                                                                                                 | Simulation: standing still eventually dies; lives decrease by one                                                                                                                                                                                                                                | 10         | S    |
| 12  | M4        | Win condition, scoring table, level bonus, digit table: lives (hives and max enemies are WP 09)                                                                                                                                                                                                                                                                         | Cleared only when nothing hostile remains; points per event; snipe shots give no points; lives per digit                                                                                                                                                                                         | 11         | S    |
| 13  | M4        | Screens (title with skill-level entry, pause, cleared, game over), HUD, high score per skill level                                                                                                                                                                                                                                                                      | E2E: start → game over → restart by keyboard; high score survives reload                                                                                                                                                                                                                         | 07, 12     | M    |
| 14  | M4        | Web Audio beeps, M = mute                                                                                                                                                                                                                                                                                                                                               | E2E: mute toggles without errors                                                                                                                                                                                                                                                                 | 13         | S    |
| 15  | M5        | Letter → feature lookup table; ghosts (through walls, intercepting the player)                                                                                                                                                                                                                                                                                          | Each letter enables exactly its features; ghost's footprint may cover walls, snipe's may not                                                                                                                                                                                                     | 12         | M    |
| 16  | M5        | Bouncing diagonal shots (1–8 random bounces); hives resisting snipe shots                                                                                                                                                                                                                                                                                               | Only the player's diagonal shots bounce, exactly their drawn N times, then stop; corner and wall-end bounces reverse both directions; no PRNG draw when off or straight; a bounced shot kills the player; snipe shots damage hives only when the flag is off                                     | 15         | M    |
| 17  | M5        | Deadly (electrified) walls                                                                                                                                                                                                                                                                                                                                              | Touching a wall (any footprint cell, 2.10) kills only when flag on                                                                                                                                                                                                                               | 15         | S    |
| 18  | M5        | Tuning, replay/determinism check, manual play checklist, version 1.0.0 in `package.json` and its `CHANGELOG.md` section. After the merge, `/release` tags v1.0.0 (5.5)                                                                                                                                                                                                  | Determinism test over recorded games; full suite green                                                                                                                                                                                                                                           | all        | S    |

WP 14 can run alongside WP 15–17, and WP 16 alongside WP 17. Everything else follows the order above. WP 01–03 are set up by hand with Claude Code, because the loop below needs them to exist; from WP 04 on, every package runs through `/implement-wp`.

### 9.2 How each work package runs

`/implement-wp <WP>` runs steps 1–3 for one work package, after checking that the working tree is clean and the package's dependencies are done.

1. **Tests.** The `test-writer` reads this spec and writes the package's tests in `tests/`. They fail at first. Commit on the package branch.
2. **Implement → verify → fix**, at most 3 verification rounds:
   1. The `developer` writes the code until the tests pass. In later rounds it gets the verifier's findings exactly as written. If it thinks a finding is wrong, or the spec is unclear, the loop stops and asks Martin.
   2. `/verify <WP>` starts a new `verifier` (6.3).
   3. PASS → step 3. FAIL or INVALID with rounds left → back to 2.1. FAIL or INVALID after round 3 → stop, leave the change uncommitted and report the remaining findings to Martin.

   Nobody edits the code between rounds outside the `developer`.

3. **Commit and PR.** Commit exactly what was verified, with the trailer `Verified: PASS`, push the branch, open the pull request and turn on auto-merge (`gh pr merge --auto --merge`). Any later change to the branch first turns auto-merge off (`gh pr merge --disable-auto`) and goes through a new verification round. `/ci-status` reports the result: `checks` and CodeQL must be green, and the preview URL is commented on the PR.
4. **Merge.** GitHub merges the PR as soon as `checks` and CodeQL pass, usually before Martin has looked at it. Martin reviews merged changes before the next release; a bad change is reverted or fixed by a new PR before tagging.
5. **Release.** The change goes live with the next release (5.5), which Martin approves once.

A package that grows beyond its size is split rather than stretched.

## 10. Open questions

- [x] ~~Which GitHub account name and which hosting service did the earlier projects use?~~ Answered from HundAlder: GitHub `martinjostrand-bit`, Cloudflare Workers via GitHub Actions (sections 5.1, 5.4, 7).
- [x] ~~Version format: keep semver or match HundAlder's `XX.YY.ZZ`?~~ Decided (Nov 8): keep plain semver on the title screen (5.5).
- [x] ~~Should the Worker name wait for the public release name?~~ Decided (Nov 8): use `snipes-web` for now. A rename after the release-name decision changes the `workers.dev` URL.
- [ ] Confirm original rules marked _(verify)_: whether ghosts shoot, what follows a cleared level, the diagonal slide order, corner gaps, opposite keys cancelling, and what counts as touching a deadly wall. Hive 20 hits and point values come from Martin's description; no source found yet. Reference: the reverse-engineered [Snipes source on GitHub](https://github.com/Davidebyzero/Snipes), used for behaviour only, never copied.
- [x] Corner gaps (2.1) for bullets and snipes, before WP 10 and WP 16 (a diagonal shot at a corner gap stops, decided Nov 16, 2.10): (a snipe's firing ignores walls and corner gaps, decided Nov 17, 2.4). Generated mazes contain no corner gaps, so tests need hand-built grids.
- [ ] Deadly walls (2.2, 2.6), before WP 17: is touching checked every tick a key is held or only when the next step is due; should a diagonal held in a one-cell corridor kill (its diagonal cell is a wall); confirm a diagonal into a corner gap is safe; after a respawn, is movement ignored until all arrow keys are released? Also add the matching tests to the WP 10, 16 and 17 rows.
- [ ] From the original's source (before WP 12 and 15): its ghosts are "small snipes" that sometimes burst against walls, at a chance that varies by letter; how should that work here? (Snipe aim by letter: decided Nov 17, 2.4 and 2.6.) Its points per kill and per hive differ from 2.7 (the HUD shows other units); keep 2.7?
- [x] ~~Exact maze size and screen view size~~ Decided (Nov 15): 256 × 240 cells, twice the original's 128 × 120 (2.10); the view is 80 × 44 cells plus the HUD row at 8 px per cell, twice the original's 40 × 22 (3).
- [x] ~~Sizes (2.10): snipe orientation, ghost and hive size, touching an enemy, where shots start, gun direction, wall segment size~~ Decided (Nov 15), see 2.10 and 3. Checked against the reverse-engineered source: everything is twice the original's size, except walls. (Wall segments were dropped on Nov 16 with destroyable walls, 11.)
- [ ] Name for public release: "Snipes" belongs to SuperSet Software; a different title (e.g. "Snipe Hunt") may be safer.
- [ ] License for our own code (MIT suggested; MissingFiles uses MIT).

## 11. Decisions log

Decisions are recorded here with their date when they are made, as in MissingFiles.

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                | Ref                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 2026-11-08 | GitHub account `martinjostrand-bit`; public repo; protected `main` with pull requests                                                                                                                                                                                                                                                                                                                   | 5.1                                              |
| 2026-11-08 | Hosting on Cloudflare Workers via GitHub Actions, with PR previews and an approval gate for production, as in HundAlder                                                                                                                                                                                                                                                                                 | 5.4, 7                                           |
| 2026-11-08 | Plain semver, defined only in `package.json`                                                                                                                                                                                                                                                                                                                                                            | 5.5                                              |
| 2026-11-08 | Worker name `snipes-web` until the public release name is decided                                                                                                                                                                                                                                                                                                                                       | 7, 10                                            |
| 2026-11-08 | Build and quality rules adopted from MissingFiles: warnings are errors, enforced coverage, CodeQL and `npm audit`, least-privilege CI                                                                                                                                                                                                                                                                   | 5.4, 5.6                                         |
| 2026-11-08 | Claude Code configuration in the repository; independent, read-only verifier; `Verified: PASS` commit trailer                                                                                                                                                                                                                                                                                           | 5.7, 6.3                                         |
| 2026-11-08 | Unlike MissingFiles, verified changes go through pull requests, not straight to `main`                                                                                                                                                                                                                                                                                                                  | 5.7, 9.2                                         |
| 2026-11-08 | LF line endings (MissingFiles uses CRLF because it is Windows-only)                                                                                                                                                                                                                                                                                                                                     | 5.6                                              |
| 2026-11-08 | Not adopted from MissingFiles: a CI build number in the version, a packaging script and release zip (the site is deployed, not downloaded), and a nightly performance workflow until a test needs one                                                                                                                                                                                                   | 5.5, 5.6                                         |
| 2026-11-09 | Our own movement rules, marked _(verify)_ against the original: a diagonal into a wall slides (horizontal first); no corner gaps for the player, snipes and bullets; opposite movement and fire keys cancel; touching a deadly wall means trying to step into it, with no slide                                                                                                                         | 2.1, 2.2, 2.8, 6.2, 9.1                          |
| 2026-11-15 | Entity sizes are physical, not only drawn: a grid of square character cells at twice the original's scale (walls stay 1 thick), 15 × 11 corridors, a 256 × 240 maze, a 4 × 4 player that moves one cell per step. M1 is reworked in a new WP 07b before WP 08                                                                                                                                           | 2.10, 3, 9.1                                     |
| 2026-11-15 | Size details: snipe 4 × 2 and always horizontal, ghost and shots 2 × 2, hive 4 × 4; touching means overlapping footprints; the player starts leaning up-left in a corridor; shots start just outside the footprint; guns show the last firing direction; a destroyable wall segment is a whole run between crossings; view 80 × 44 cells + HUD at 8 px; the 07b test-writer commit may replace M1 tests | 2.10, 3, 6.3, 10                                 |
| 2026-11-16 | A diagonal shot at a corner gap stops, like a shot that hits a wall                                                                                                                                                                                                                                                                                                                                     | 2.10, 10                                         |
| 2026-11-16 | Verified PRs merge automatically when their required checks pass; production deploys only on a release tag, with Martin's approval once per release; one release per milestone; Martin reviews after merge and plays a staging preview of `main` before each release                                                                                                                                    | 5.1, 5.4, 5.5, 5.6, 5.7, 6.3, 7, 9, 9.1, 9.2, 11 |
| 2026-11-16 | Logic at 60 ticks/s; player 20 cells/s, 30 with Space; shots 1 cell per tick, one every 13 ticks; letter and digit tables, bouncing (diagonal, 1–8 random bounces) and hives resisting snipe shots taken from the original's source; destroyable walls dropped                                                                                                                                          | 2.2, 2.5, 2.6, 2.9, 2.10, 4.3, 9, 9.1, 10        |
| 2026-11-16 | No firing while Space is held; only the player's diagonal shots bounce, reversing both directions at corners and wall ends; bounced shots kill the player; snipe shots damage hives (no points) and kill other enemies, as in the original                                                                                                                                                              | 2.2, 2.5, 9.1                                    |
| 2026-11-17 | Optional `?seed=N` URL parameter, so e2e tests start from a known maze; the 6.3 test exception also covers setup that a new feature changes                                                                                                                                                                                                                                                             | 4.3, 6.3, 9.1                                    |
| 2026-11-17 | Snipes move, turn and fire as in the original: fire only along their direction at an aligned player, with a chance that falls with distance and rises with the letter's accuracy; walls don't stop them firing                                                                                                                                                                                          | 2.4, 2.6, 2.7, 9.1, 10                           |
| 2026-11-17 | Snipe details: walls and hives block snipes, snipes may overlap each other and the player; a fixed PRNG draw order for every chance; the order of events within a tick                                                                                                                                                                                                                                  | 2.4, 4.3, 9.1                                    |
| 2026-11-21 | Hives count like walls in a snipe's corner-gap test                                                                                                                                                                                                                                                                                                                                                     | 2.4                                              |
| 2026-11-21 | A safe respawn spot is a block start position with no hive in its block and no snipe or snipe shot in it or the 8 blocks around it, searched farthest from the death first; a player shot early in a tick does not move that tick; a touch counts after the player moves and after the snipes step                                                                                                      | 2.2, 2.4                                         |

## Sources

- [snipes(6) manual page](https://manpath.be/f29/6/snipes) – controls, letter feature chart, hives and max enemies per digit (from-scratch remake of the Novell version; superseded for the 2.6 tables on Nov 16)
- [Snipes reverse-engineered source (Davidebyzero, GitHub)](https://github.com/Davidebyzero/Snipes) – letter and digit tables, speeds, bouncing, fire rate and sizes; read for behaviour only, never copied
- [Snipes cheats – Cyberly](https://www.cyberly.org/game-cheats/pc/snipes.html) – skill level A1–Z9 description
- [Snipes (video game) – Wikipedia](<https://en.wikipedia.org/wiki/Snipes_(video_game)>)
- [Snipes – Lutris](https://lutris.net/games/snipes/) – win condition: all generators and snipes destroyed
- [Novell and the computer game that changed networking – Network World](https://www.networkworld.com/article/2297960/novell-and-the-computer-game-that-changed-networking.html)
- [Snipes – Giant Bomb](https://www.giantbomb.com/snipes/3030-12025/)
