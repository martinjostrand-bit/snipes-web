# Changelog

Each release covers one milestone (spec 5.5 and 9). Versions follow semantic versioning.

## 0.5.0 – 2026-11-24 – M4 Game flow

- The page opens on a title screen with the name, the version, the skill level and the best score for it. Type a letter A–Z and a digit 1–9 to change the skill level, and press Enter to start. The skill level last started is remembered.
- The skill digit sets the lives. A hive destroyed gives 100 points and a snipe killed 10, when the player's shot hits it. Clearing every hive and snipe wins the game, with a bonus for the lives left and the time taken. Losing the last life ends the game 2 seconds later.
- P or Esc pauses and resumes. The won and game-over screens show the score, the best score for the skill level and "New best!" for a new one; Enter or R plays again and Esc goes back to the title. The best score per skill level is kept in the browser.
- The HUD shows the score, lives, skill level, and the hives and snipes left.
- Short beeps, made in the browser with no audio files, for a shot, a hit, a hive destroyed and a death. M mutes and unmutes while playing, paused and on the won and game-over screens; on the title M is a letter. Mute is remembered in the browser.
- Letter keys work in either case, and the screen, skill-level, pause and mute keys ignore a held key's auto-repeat.
- Sharper look at 16 px per cell (1280 × 720 at × 1): smooth sprites, a bird-head player whose eyes follow its last shot and blink, and the player, snipes and shots slide smoothly from cell to cell.

## 0.4.0 – 2026-11-21 – M3 Hives and snipes

- Hives, 3 to 10 by the skill digit, sit at random spots in the maze. Each spawns a snipe every 2 seconds while there are fewer enemies on the map than the digit allows, changes colour as it takes hits and breaks on the 20th.
- Snipes roam the corridors, chase the player with some randomness and fire along their way when it lines up with the player, more often the nearer it is and the more accurate the skill letter makes them. Walls and hives block them. Their shots stop at walls, damage hives and kill other snipes. One shot from the player kills a snipe.
- A snipe's shot or a snipe touching the player kills it and costs a life. After 2 seconds the player comes back in the middle of the block farthest from where it died that has no hive in it and no snipe or snipe shot in or next to it. Out of play it is not shown, cannot be hurt and does not fire.
- Every game starts at skill level A1 with 5 lives until the title screen and the lives table come in M4.

## 0.3.0 – 2026-11-16 – M2 Shooting

- W A S D fire in 8 directions, diagonally with two keys held, independent of movement; opposite keys cancel each other. Holding a fire key fires every 13 ticks (about 4.6 shots a second); tapping cannot fire faster, and nothing is fired while Space is held. The player's guns point in the last firing direction.
- A shot is 2 × 2 cells and appears just outside the player in the firing direction. It flies in a straight line at 60 cells a second, twice as fast as the player with Space, until the first wall, and wraps at the maze edges. A diagonal shot stops at a corner gap. Walls are unharmed.
- Game logic now runs at 60 ticks per second, in step with a 60 Hz screen. The player steps every 3 ticks (20 cells a second), or every 2 while Space is held (30 cells a second).

## 0.2.0 – 2026-11-16 – M1 Maze and movement

- A random maze for every game, made from a seed: 256 × 240 cells in 16 × 20 blocks, with 15 × 11 corridors and walls 1 cell thick, wrapping at all four edges. Every place the player fits can be reached.
- A 4 × 4 player that moves one cell at a time in 8 directions with the arrow keys, faster while Space is held. A diagonal into a wall slides along it, corner gaps block diagonal moves, and opposite keys cancel each other.
- A view of 80 × 44 cells that scrolls to keep the player centred, drawn at a whole-number scale, with double-line walls and a top line showing the title and version.
- Game logic at a fixed 30 ticks per second, separate from drawing.

## 0.1.0 – M0 Skeleton

Not released on its own; included in 0.2.0.

- Build, checks, tests, CI with CodeQL, pull request previews and a gated production deploy on Cloudflare Workers.
- A blank page with the title and version number.
