# Fathom

**Hunt in the dark.** A bioluminescent deep-sea maze chase, playable entirely in your browser.

Graze the glowing plankton, remember the corridors, and descend when the maze is clean. Eating expands your circular view of the trench — but the brighter you shine, the farther its hunters can see you. Sonar travels around corners. Unfortunately, something down here is listening.

## Play locally

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. No account, backend, external font, or network service is needed.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Swim; up/down select menu items |
| Space | Send sonar (1.5-second cooldown) |
| Shift | Drop ink (8-second cooldown) |
| Enter / Space | Confirm a menu item |
| Escape / P | Pause / resume |
| Escape | Return from the field guide or game-over screen |
| M | Toggle sound |
| Backtick | Engine debug overlay |

Menus also accept a mouse, pen, or touch. Touch devices get the engine's directional pad and action buttons automatically. Release movement to stop; turns buffer until the next tile center. You can reverse immediately.

### Know the water

- **Lanternjaw** hunts light. Its amber lure looks just like a harmless bonus drifter. Sonar cannot tell them apart.
- **Gloamfin** hunts sound. Violet pings search the corridors; an orange ping means it has lost your trail. Corners slow its chase. Ink does not fool it.
- **Flarefish** hunts light and periodically illuminates a wide disc through rock. Get clear of the flash, or drop ink to break its lock.

Ground revealed by light, sonar, or a flare stays remembered. In the **Kindle** dive, even remembered ground disappears beyond your outer vision circle. The hunters can still appear beyond it when sonar marks or alerts reveal them.

## Production build

```sh
npm run build
npm run preview
```

`dist/index.html` is the entry point. Serve **the entire `dist/` directory** from any static server, at its root or beneath a sub-path. Art and code resolve relative to the page. There is no separate asset-processing step.

## Checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests run the real Simple 2D engine with a headless canvas and counted clocks. They cover the maze invariants, fixed-step timing, movement, fog, sonar, ink, hunting, scoring, contact, menus, and validated debug poses. Coverage and test reports are written to `coverage/`.

## Source map

- `src/game.ts` — engine registrations, input, frame-to-tick bridge; exports `game`, `BACKGROUND`, and the state/debug types.
- `src/state.ts` — value state, maze, roster, immutable copying, and derived readings.
- `src/world.ts` — center-line travel, pathfinding, line of sight, and lighting.
- `src/simulation.ts` — render-free 120 Hz simulation and predator minds.
- `src/debug.ts` — pure snapshots and independent, validated state transitions.
- `src/render.ts` — pixel-art terrain and creatures, glow, wavefronts, HUD, and screens.

The engine owns the canvas fit, frame loop, input, audio, asset loading, diagnostics, and recorder. The simulation's timers and seeded wander generator live in the returned state. Rendering never advances the world. The debug surface is available only as `engine.debug`; nothing is installed on the page.

## Showcase

See [`showcase/showcase.md`](showcase/showcase.md) for the player-facing presentation, with screenshots and a six-second engine draw-command replay. To regenerate the captures, run the development server, then:

```sh
node tools/capture.mjs
```

The capture driver uses project-local Playwright and its Chromium with `--no-sandbox`. Its scenario is staged through the game's debug transitions, explored with real sonar, and recorded through the engine's recorder.
