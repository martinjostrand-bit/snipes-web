# Changelog

Each release covers one milestone (spec 5.5 and 9). Versions follow semantic versioning.

## 0.3.0 – 2026-11-16 – M2 Shooting

- W A S D fire in 8 directions, diagonally with two keys held, independent of movement; opposite keys cancel each other. Holding a fire key keeps firing. The player's guns point in the last firing direction.
- A shot is 2 × 2 cells and appears just outside the player in the firing direction. It flies in a straight line, faster than the player, until the first wall, and wraps at the maze edges. A diagonal shot stops at a corner gap. Walls are unharmed.

## 0.2.0 – 2026-11-16 – M1 Maze and movement

- A random maze for every game, made from a seed: 256 × 240 cells in 16 × 20 blocks, with 15 × 11 corridors and walls 1 cell thick, wrapping at all four edges. Every place the player fits can be reached.
- A 4 × 4 player that moves one cell at a time in 8 directions with the arrow keys, faster while Space is held. A diagonal into a wall slides along it, corner gaps block diagonal moves, and opposite keys cancel each other.
- A view of 80 × 44 cells that scrolls to keep the player centred, drawn at a whole-number scale, with double-line walls and a top line showing the title and version.
- Game logic at a fixed 30 ticks per second, separate from drawing.

## 0.1.0 – M0 Skeleton

Not released on its own; included in 0.2.0.

- Build, checks, tests, CI with CodeQL, pull request previews and a gated production deploy on Cloudflare Workers.
- A blank page with the title and version number.
