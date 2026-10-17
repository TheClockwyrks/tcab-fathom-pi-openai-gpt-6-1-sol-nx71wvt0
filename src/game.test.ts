/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine } from "@clockwyrks/simple-2d";
import { BACKGROUND, game } from "./game";
import type { FathomState, FathomDebugApi } from "./game";
import * as C from "./constants";
import { center, clone, fresh, layer, put } from "./state";
import { debug } from "./debug";
import {
  distance,
  flood,
  lineClear,
  open,
  route,
  segmentDistance,
} from "./world";
const engines: Engine<FathomState, FathomDebugApi>[] = [];
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (path: string) => new Response(await readFile(path)),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.destroy());
});
async function setup(step = 1000 / 120) {
  const target = new EventTarget(),
    canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const e = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    background: BACKGROUND,
    game,
    layout: C.LAYOUT,
    clock: new ConstantClock(step),
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => target,
    },
  });
  engines.push(e);
  await e.initialize();
  function key(code: string, down = true) {
    const event = new Event(down ? "keydown" : "keyup");
    Object.assign(event, { code, repeat: false });
    target.dispatchEvent(event);
  }
  function pointer(type: string, x: number, y: number, id = 1) {
    const event = new Event(`pointer${type}`);
    Object.assign(event, {
      clientX: x,
      clientY: y,
      pointerId: id,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "up" ? 0 : 1,
    });
    target.dispatchEvent(event);
  }
  return { e, d: e.debug, key, pointer, canvas };
}
function fixture() {
  const rows = layer("#");
  for (let x = 1; x < 35; x++) put(rows, x, 5, ".");
  for (let y = 1; y < 17; y++) put(rows, 5, y, ".");
  return rows;
}
function quiet(e: Engine<FathomState, FathomDebugApi>) {
  e.apply((s) => debug.clearPredators(s));
  e.apply((s) => debug.clearPlankton(s));
  e.apply((s) => debug.setMaze(s, fixture()));
  e.apply((s) => debug.setForagerTile(s, 5, 5));
  e.apply((s) => debug.setScreen(s, "playing"));
}
describe("the engine contract", () => {
  it("loads all seeded art, returns the complete initial snapshot and registers diagnostics", async () => {
    const { e, d } = await setup();
    const s = d.snapshot(e.state);
    expect(s.screen).toBe("title");
    expect(s.version).toBe(C.FATHOM_DEBUG_VERSION);
    expect(s.lives).toBe(C.START_LIVES);
    expect(s.predators.map((p) => p.kind)).toEqual(C.DEN_ORDER);
    expect(s.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(Object.values(e.state.art).reduce((n, a) => n + a.length, 0)).toBe(
      75,
    );
    expect(e.diagnostics().every((d) => d.error === undefined)).toBe(true);
    expect(e.diagnostics().map((d) => d.name)).toContain("windowRadius");
    await e.advance(1);
    expect(e.state.simTime).toBeCloseTo(C.TICK_DT);
  });
  it("leaves previous state immutable and is deterministic across frame partitions", async () => {
    const a = await setup(1000 / 60),
      b = await setup();
    quiet(a.e);
    quiet(b.e);
    a.key("ArrowRight");
    b.key("ArrowRight");
    const before = a.d.snapshot(a.e.state);
    const ref = a.e.state;
    await a.e.advance(30);
    await b.e.advance(60);
    expect(a.d.snapshot(ref)).toEqual(before);
    expect(a.d.snapshot(a.e.state)).toEqual(b.d.snapshot(b.e.state));
    b.e.setClock(new SequenceClock([2, 7, 16]));
    await b.e.advance(3);
    expect(b.e.state.simTime).toBeCloseTo(0.525);
  });
  it("carries fractional time and input edges into the next tick", async () => {
    const { e, key } = await setup(1000 / 480);
    quiet(e);
    key("Space");
    await e.advance(3);
    expect(e.state.pulses).toHaveLength(0);
    await e.advance(1);
    expect(e.state.pulses).toHaveLength(1);
    expect(e.state.simTime).toBeCloseTo(C.TICK_DT);
  });
  it("resets every observable field without clearing the mute preference", async () => {
    const { e, d, key } = await setup();
    quiet(e);
    key("KeyM");
    await e.advance(1);
    e.apply((s) => d.setDepth(s, 9));
    e.apply((s) => d.setScore(s, 99));
    e.apply((s) => d.reset(s));
    expect(d.snapshot(e.state)).toEqual(d.snapshot(fresh({}, true)));
  });
});
describe("a conforming maze", () => {
  it("is connected, symmetric, enclosed, single-width, and within all three proportions", () => {
    const s = fresh(),
      cells: number[] = [];
    const degrees = new Map<number, number>();
    const paths = flood(s, s.start.tx, s.start.ty);
    let mouths = 0;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const t = s.tiles[y][x],
          mirror = s.tiles[y][35 - x];
        if (!"dg".includes(t) && !"dg".includes(mirror)) expect(t).toBe(mirror);
        if (t !== ".") continue;
        const key = y * 36 + x;
        cells.push(key);
        expect(paths.has(key)).toBe(true);
        const ns = [
          [x, y - 1],
          [x, y + 1],
          [(x + 35) % 36, y],
          [(x + 1) % 36, y],
        ].filter(([xx, yy]) => open(s, xx, yy));
        degrees.set(key, ns.length);
        expect(ns.length).toBeGreaterThanOrEqual(2);
        expect(
          s.tiles[y]?.[x + 1] === "." &&
            s.tiles[y + 1]?.[x] === "." &&
            s.tiles[y + 1]?.[x + 1] === ".",
        ).toBe(false);
        if (x === 0) mouths++;
        if (x === 0 || x === 35) expect(y).toBe(8);
        if (y === 0 || y === 17) throw new Error("Open border");
      }
    expect(mouths).toBe(1);
    const density = cells.length / 544,
      openness =
        [...degrees.values()].reduce((a, b) => a + b, 0) / cells.length;
    expect(density).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(density).toBeLessThanOrEqual(C.MAZE_DENSITY_MAX);
    expect(openness).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(openness).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const runs = new Set(cells.filter((k) => degrees.get(k) === 2)),
      lengths: number[] = [];
    while (runs.size) {
      const queue = [runs.values().next().value!];
      runs.delete(queue[0]);
      for (let i = 0; i < queue.length; i++) {
        const k = queue[i],
          x = k % 36,
          y = Math.floor(k / 36);
        for (const [xx, yy] of [
          [x, y - 1],
          [x, y + 1],
          [(x + 35) % 36, y],
          [(x + 1) % 36, y],
        ]) {
          const n = yy * 36 + xx;
          if (runs.delete(n)) queue.push(n);
        }
      }
      lengths.push(queue.length);
    }
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    expect(mean).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(mean).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    for (let y = 7; y <= 9; y++)
      for (let x = 16; x <= 19; x++) {
        expect(s.tiles[y][x]).toBe("d");
        expect(flood(s, x, y, true).has(s.start.ty * 36 + s.start.tx)).toBe(
          true,
        );
      }
  });
  it("finds routes around rock rather than cutting across it", () => {
    let s = debug.setMaze(fresh(), fixture());
    s = debug.setForagerTile(s, 3, 5);
    expect(route(s, s.forager, { tx: 5, ty: 2 })).toBe("right");
    expect(lineClear(s, center(3, 5), center(5, 2))).toBe(false);
    expect(
      segmentDistance({ x: 2, y: 2 }, { x: 0, y: 0 }, { x: 4, y: 0 }),
    ).toBe(2);
    expect(distance(center(1, 1), center(2, 1))).toBe(C.TILE);
  });
});
describe("movement and grazing", () => {
  it("travels at a constant rate, stops when released, reverses mid-tile, and buffers corners", async () => {
    const { e, key } = await setup();
    quiet(e);
    key("ArrowRight");
    await e.advance(15);
    expect(e.state.forager.x).toBeCloseTo(center(5, 5).x + 16);
    key("ArrowRight", false);
    await e.advance(5);
    expect(e.state.forager.moving).toBe(false);
    key("ArrowLeft");
    await e.advance(15);
    expect(e.state.forager.x).toBeCloseTo(center(5, 5).x);
    key("ArrowLeft", false);
    key("ArrowUp");
    await e.advance(30);
    expect(e.state.forager.y).toBeCloseTo(center(5, 4).y);
  });
  it("takes buffered perpendicular turns only at centers", async () => {
    const { e, key } = await setup();
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 4, 5));
    key("ArrowRight");
    await e.advance(15);
    key("ArrowUp");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(5, 5).x);
    expect(e.state.forager.y).toBeCloseTo(center(5, 5).y - 16);
  });
  it("wraps continuously across the one-step tunnel", async () => {
    const { e, key } = await setup();
    e.apply((s) => debug.clearPredators(s));
    e.apply((s) => debug.clearPlankton(s));
    e.apply((s) => debug.setForagerTile(s, 0, 8));
    e.apply((s) => debug.setScreen(s, "playing"));
    key("ArrowLeft");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(35, 8).x);
    expect(e.state.forager.tx).toBe(35);
  });
  it("cannot move through rock or across closed fixture tiles", async () => {
    const { e, key } = await setup();
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 3, 5));
    key("ArrowDown");
    await e.advance(15);
    expect(e.state.forager.ty).toBe(5);
    e.apply((s) => debug.setMaze(s, layer("#")));
    key("ArrowRight");
    await e.advance(15);
    expect(e.state.forager.tx).toBe(3);
  });
  it("eats on tile entry, scores, holds light, and clears only by eating", async () => {
    const { e, key } = await setup();
    quiet(e);
    e.apply((s) => debug.setPlankton(s, 6, 5, true));
    e.apply((s) => debug.setPlankton(s, 7, 5, true));
    key("ArrowRight");
    await e.advance(16);
    expect(e.state.score).toBe(C.SCORE_PLANKTON);
    expect(e.state.brightness).toBe(C.BRIGHT_PER_EAT);
    expect(e.state.brightHold).toBe(C.BRIGHT_HOLD);
    await e.advance(30);
    expect(e.state.screen).toBe("cleared");
    expect(e.state.score).toBe(C.SCORE_PLANKTON * 2 + C.SCORE_CLEAR);
    await e.advance(240);
    expect(e.state.depth).toBe(2);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.predators).toHaveLength(4);
  });
  it("admits drifters on cadence, freezes their mind/body separately, and awards the bonus", async () => {
    const { e } = await setup();
    quiet(e);
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
    e.apply((s) => debug.spawnDrifter(s, 6, 5));
    e.apply((s) => debug.setDrifterMind(s, 0, false));
    await e.advance(10);
    expect(e.state.drifters[0].tx).toBe(6);
    e.apply((s) => debug.setDrifterMind(s, 0, true));
    e.apply((s) => debug.setDrifterTravel(s, 0, false));
    await e.advance(10);
    expect(e.state.drifters[0].tx).toBe(6);
    e.apply((s) => debug.setForagerTile(s, 6, 5));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_DRIFTER);
    expect(e.state.drifters).toHaveLength(0);
    e.apply((s) => debug.setMaze(s, fresh().tiles));
    e.apply((s) => debug.setPlankton(s, 1, 1, true));
    e.apply((s) => debug.setDrifterIn(s, 0));
    await e.advance(1);
    expect(e.state.drifters).toHaveLength(1);
    expect(e.state.drifterIn).toBe(C.DRIFTER_INTERVAL);
  });
});
describe("light, sonar and ink", () => {
  it("derives both radii and decays exactly after the hold", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.setBrightness(s, 1));
    e.apply((s) => debug.setBrightHold(s, C.BRIGHT_HOLD));
    expect(e.state.windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN,
    );
    await e.advance(120);
    expect(e.state.brightness).toBeCloseTo(1);
    await e.advance(108);
    expect(e.state.brightness).toBeCloseTo(0.5);
  });
  it("lights the first rock, blocks behind it, remembers terrain, and reconciles without sensing", async () => {
    const { e } = await setup();
    quiet(e);
    await e.advance(1);
    expect(e.state.visibility[4][4]).toBe("l");
    expect(e.state.visibility[3][3]).toBe("u");
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    await e.advance(1);
    expect(e.state.visibility[5][5]).toBe("r");
    e.apply((s) => debug.clearFog(s));
    e.apply((s) => debug.reconcile(s));
    expect(e.state.visibility.every((r) => /^u+$/.test(r))).toBe(true);
  });
  it("floods around a corner over time, marks non-amber hunters, and emits one cue per tick", async () => {
    const { e, key } = await setup();
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 2, 5));
    e.apply((s) => debug.addPredator(s, "gloamfin", 5, 2));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    const cues: string[] = [];
    e.events.on("cue:played", (ev) => cues.push(ev.cue));
    key("Space");
    await e.advance(1);
    expect(e.state.visibility[2][5]).toBe("u");
    expect(e.state.pulses[0].front).toBeCloseTo(C.SONAR_WAVE_SPEED * C.TICK_DT);
    await e.advance(54);
    expect(e.state.visibility[2][5]).toBe("l");
    expect(e.state.predators[0].lit).toBe(true);
    expect(cues).toEqual([C.CUES.sonar]);
    await e.advance(200);
    expect(e.state.predators[0].lit).toBe(false);
    expect(e.state.sonar.ready).toBe(true);
  });
  it("casts fixed ink, blinds sight but never hearing, and expires clouds", async () => {
    const { e, key } = await setup();
    quiet(e);
    e.apply((s) => debug.addPredator(s, "lanternjaw", 8, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("chase");
    key("ShiftLeft");
    await e.advance(1);
    expect(e.state.inkClouds).toHaveLength(1);
    expect(e.state.predators[0].state).toBe("wander");
    e.apply((s) => debug.addPredator(s, "gloamfin", 7, 5));
    e.apply((s) => debug.setPredatorTravel(s, 1, false));
    await e.advance(1);
    expect(e.state.predators[1].hearingLock).toBe(true);
    await e.advance(361);
    expect(e.state.inkClouds).toHaveLength(0);
    expect(e.state.ink.ready).toBe(false);
  });
});
describe("hunters and contact", () => {
  it("releases on live-play time with travel independent of the schedule", async () => {
    const { e } = await setup(1000 / 60);
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    e.apply((s) => debug.setScreen(s, "countdown"));
    await e.advance(120);
    expect(e.state.predators[0].released).toBe(true);
    expect(e.state.predators.slice(1).every((p) => !p.released)).toBe(true);
    await e.advance(1);
    expect(e.state.predators[0].released).toBe(true);
    expect(e.state.predators[0].state).toBe("den");
    await e.advance(300);
    expect(e.state.predators[1].released).toBe(true);
    expect(e.state.predators[2].released).toBe(false);
  });
  it("swims through the chamber rather than teleporting at release", async () => {
    const { e } = await setup(1000 / 60);
    e.apply((s) => debug.setScreen(s, "playing"));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("den");
    await e.advance(75);
    expect(e.state.predators[0].state).not.toBe("den");
    expect(tileAt(e.state.predators[0].tx, e.state.predators[0].ty)).toBe(".");
    function tileAt(x: number, y: number) {
      return e.state.tiles[y][x];
    }
  });
  it("takes a sight fix without travel, lingers on lapse, and does not alert as a Lanternjaw", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.addPredator(s, "lanternjaw", 8, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].speed).toBe(C.PREDATOR_SPEED);
    expect(e.state.predators[0].alert).toBe(false);
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    await e.advance(120);
    expect(e.state.predators[0].state).toBe("chase");
    await e.advance(121);
    expect(e.state.predators[0].state).toBe("wander");
    expect(e.state.predators[0].speed).toBe(C.DRIFTER_SPEED);
  });
  it("keeps mind-disabled hunters fixed and still makes contact with them", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.addPredator(s, "flarefish", 8, 5));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    await e.advance(120);
    expect(e.state.predators[0].state).toBe("wander");
    e.apply((s) => debug.setForagerTile(s, 8, 5));
    await e.advance(1);
    expect(e.state.lives).toBe(C.START_LIVES - 1);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.forager.moving).toBe(false);
    expect(
      e.state.predators.every((p) => p.state === "den" && !p.released),
    ).toBe(true);
    e.apply((s) => debug.setLives(s, 0));
    e.apply((s) => debug.clearPredators(s));
    e.apply((s) => debug.addPredator(s, "gloamfin", 5, 13));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    e.apply((s) => debug.setScreen(s, "playing"));
    await e.advance(1);
    expect(e.state.screen).toBe("gameover");
    expect(e.state.lives).toBe(0);
  });
  it("hears through rock, fires the violet ping and acquires only on front arrival", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 2, 5));
    e.apply((s) => debug.addPredator(s, "gloamfin", 9, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(480);
    expect(e.state.pulses.some((p) => p.tint === "violet")).toBe(true);
    expect(e.state.predators[0].state).toBe("wander");
    await e.advance(62);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].alert).toBe(true);
    expect(e.state.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("searches an empty fixed tile then casts its guaranteed orange ping", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.addPredator(s, "gloamfin", 9, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    e.apply((s) => debug.setPredatorState(s, 0, "chase"));
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    e.apply((s) => debug.setPredatorTile(s, 0, 5, 5));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("search");
    await e.advance(145);
    expect(e.state.pulses.some((p) => p.tint === "orange")).toBe(true);
    await e.advance(460);
    expect(e.state.predators[0].state).toBe("wander");
  });
  it("charges, blooms through rock, reveals memory and resets the flare timer", async () => {
    const { e } = await setup(1000 / 60);
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    e.apply((s) => debug.addPredator(s, "flarefish", 5, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(421);
    expect(e.state.predators[0].flareCharging).toBe(true);
    await e.advance(30);
    expect(e.state.predators[0].flaring).toBe(true);
    expect(e.state.predators[0].flareRadius).toBe(C.FLARE_RADIUS);
    expect(e.state.visibility[3][3]).toBe("l");
    await e.advance(61);
    expect(e.state.predators[0].flaring).toBe(false);
    expect(e.state.visibility[3][3]).toBe("r");
  });
  it("uses close light acquisition for a Flarefish independently of its flare", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.addPredator(s, "flarefish", 8, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].alert).toBe(true);
    expect(e.state.predators[0].flaring).toBe(false);
  });
});
describe("screens, keys, and pointer menus", () => {
  it("remembers the title item, navigates how-to, and supports pointer confirmation", async () => {
    const { e, d, key, pointer } = await setup();
    key("ArrowUp");
    await e.advance(1);
    expect(e.state.menuIndex).toBe(1);
    key("Enter");
    await e.advance(1);
    expect(e.state.screen).toBe("howto");
    expect(e.state.titleIndex).toBe(1);
    key("Enter", false);
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    expect(e.state.menuIndex).toBe(1);
    const r = d.menuItemRect(e.state, 0)!;
    pointer("down", r.x + 20, r.y + 20);
    pointer("up", r.x + 20, r.y + 20);
    await e.advance(1);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.titleIndex).toBe(0);
    await e.advance(240);
    expect(e.state.screen).toBe("playing");
  });
  it("does not confirm across different pointer regions, but accepts how-to clicks", async () => {
    const { e, pointer } = await setup();
    pointer("down", 520, 420);
    pointer("up", 520, 480);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    expect(e.state.menuIndex).toBe(1);
    pointer("down", 520, 480);
    pointer("up", 520, 480);
    await e.advance(1);
    expect(e.state.screen).toBe("howto");
    pointer("down", 50, 50);
    pointer("up", 51, 50);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
  });
  it("pauses once per Escape and leaves the board frozen while its clock accumulates", async () => {
    const { e, key } = await setup();
    quiet(e);
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("paused");
    const x = e.state.forager.x,
      clock = e.state.simTime;
    key("ArrowRight");
    await e.advance(120);
    expect(e.state.forager.x).toBe(x);
    expect(e.state.simTime).toBeCloseTo(clock + 1);
    key("Escape", false);
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
  });
  it.each([
    ["paused", 1, "countdown"],
    ["paused", 2, "title"],
    ["gameover", 0, "countdown"],
    ["gameover", 1, "title"],
  ] as const)(
    "confirms %s item %i to %s",
    async (screen, index, destination) => {
      const { e, key } = await setup();
      e.apply((s) => debug.setScreen(s, screen));
      e.apply((s) => debug.setMenuIndex(s, index));
      key("Enter");
      await e.advance(1);
      expect(e.state.screen).toBe(destination);
    },
  );
  it("mutes on every screen without stopping cue events", async () => {
    const { e, key } = await setup();
    quiet(e);
    key("KeyM");
    key("Space");
    const gains: number[] = [];
    e.events.on("cue:played", (ev) => gains.push(ev.gain));
    await e.advance(1);
    expect(e.state.muted).toBe(true);
    expect(gains).toEqual([0]);
    key("KeyM", false);
    key("KeyM");
    await e.advance(1);
    expect(e.state.muted).toBe(false);
  });
});
describe("debug poses are independent, validated value transitions", () => {
  it("accepts fixture irregularities without repairing, relocating, or scoring", () => {
    const original = fresh();
    const s = debug.setMaze(original, layer("#"));
    expect(s.forager).toEqual(original.forager);
    expect(s.plankton).toEqual(original.plankton);
    expect(s.score).toBe(0);
    expect(original.tiles).not.toEqual(s.tiles);
    expect(debug.menuItemRect(s, -1)).toBeNull();
    expect(debug.menuItemRect(debug.setScreen(s, "playing"), 0)).toBeNull();
  });
  it("reconciles only derived values, with no advance or sensing", () => {
    let s = clone(fresh());
    s.forager.x = center(7, 5).x;
    s.forager.y = center(7, 5).y;
    s.brightness = 0.6;
    s.depth = 4;
    s.sonar.cooldown = 9;
    s.ink.cooldown = 3;
    s = debug.reconcile(s);
    expect(s.forager.tx).toBe(7);
    expect(s.sonar.range).toBe(6);
    expect(s.sonar.ready).toBe(false);
    expect(s.ink.ready).toBe(false);
    expect(s.simTime).toBe(0);
    expect(debug.reconcile(s)).toEqual(s);
    expect(s.visibility).toEqual(layer("u"));
  });
  it("poses every independent body field and allows more drifters than the cadence cap", () => {
    let s = fresh();
    s = debug.setScore(s, 100);
    s = debug.setLives(s, 9);
    s = debug.setDepth(s, 10);
    expect(s.predators).toHaveLength(C.ROSTER_CAP * C.DEN_ORDER.length);
    s = debug.clearPredators(s);
    s = debug.addPredator(s, "lanternjaw", 5, 5);
    s = debug.setPredatorDir(s, 0, "right");
    s = debug.setPredatorTile(s, 0, 9, 5);
    s = debug.setPredatorState(s, 0, "chase");
    s = debug.setPredatorReleased(s, 0, false);
    expect(s.predators[0].speed).toBe(C.PREDATOR_SPEED);
    expect(s.predators[0].released).toBe(false);
    s = debug.setPredatorTile(s, 0, 16, 8);
    s = debug.setPredatorState(s, 0, "den");
    expect(s.predators[0].state).toBe("den");
    for (let i = 0; i < 4; i++) s = debug.spawnDrifter(s, 5, 5);
    expect(s.drifters).toHaveLength(4);
    s = debug.clearDrifters(s);
    expect(s.drifters).toHaveLength(0);
    s = debug.setSonarCooldown(s, 90);
    s = debug.setInkCooldown(s, 91);
    s = debug.setForagerDir(s, "down");
    s = debug.setTitleIndex(s, 1);
    expect(s.titleIndex).toBe(1);
    expect(s.menuIndex).toBe(0);
    expect(s.forager.dir).toBe("down");
  });
  it.each([
    () => debug.setScore(fresh(), -1),
    () => debug.setLives(fresh(), 1.1),
    () => debug.setDepth(fresh(), 0),
    () => debug.setBrightness(fresh(), 2),
    () => debug.setBrightHold(fresh(), 2),
    () => debug.setDrifterIn(fresh(), 30),
    () => debug.setSonarCooldown(fresh(), NaN),
    () => debug.setInkCooldown(fresh(), -1),
    () => debug.setForagerTile(fresh(), 0, 0),
    () => debug.setPredatorMind(fresh(), 99, false),
    () => debug.setDrifterMind(fresh(), 0, false),
    () => debug.setMenuIndex(debug.setScreen(fresh(), "playing"), 0),
    () => debug.setTitleIndex(fresh(), 9),
    () => debug.setMaze(fresh(), ["."]),
    () => debug.setMaze(fresh(), layer("x")),
    () => debug.setMaze(fresh(), layer("d")),
    () => debug.setPredatorState(fresh(), 0, "wander"),
  ])("rejects invalid arguments loudly (%#)", (operation) => {
    expect(operation).toThrow(RangeError);
  });
});

describe("edge scenarios", () => {
  it("pings as soon as a hearing lock breaks, subject to the minimum gap", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.addPredator(s, "gloamfin", 7, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0].hearingLock).toBe(true);
    expect(e.state.pulses).toHaveLength(0);
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    await e.advance(1);
    expect(e.state.predators[0].hearingLock).toBe(false);
    expect(e.state.pulses[0].tint).toBe("violet");
    e.apply((s) => debug.setForagerTile(s, 5, 5));
    await e.advance(1);
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    await e.advance(1);
    expect(e.state.pulses).toHaveLength(1);
  });
  it("does not sample past thin corner intersections in line of sight", () => {
    const rows = layer(".");
    put(rows, 6, 6, "#");
    const s = debug.setMaze(fresh(), rows);
    const a = center(5, 5),
      b = { x: center(7, 6).x, y: 277.9 };
    expect(lineClear(s, a, b)).toBe(false);
    expect(lineClear(s, b, a)).toBe(false);
    expect(lineClear(s, a, center(6, 6), true)).toBe(true);
  });
  it("masks remembered ground at a true circular edge but draws sonar-marked hunters over it", async () => {
    const { e, key, canvas } = await setup();
    quiet(e);
    for (const x of [9, 13, 5]) {
      e.apply((s) => debug.setForagerTile(s, x, 5));
      await e.advance(1);
    }
    expect(e.state.visibility[5][13]).toBe("r");
    const ctx = canvas.getContext("2d");
    const pixel = (x: number, y: number) =>
      Array.from(ctx.getImageData(x, y, 1, 1).data);
    const edge = center(5, 5).x + C.KINDLE_VISION_MIN;
    expect(pixel(edge + 3, center(5, 5).y)).toEqual([3, 6, 12, 255]);
    expect(pixel(edge - 3, center(5, 5).y)).not.toEqual([3, 6, 12, 255]);
    e.apply((s) => debug.addPredator(s, "gloamfin", 13, 5));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    key("Space");
    await e.advance(85);
    expect(e.state.predators[0].lit).toBe(true);
    const c = center(13, 5),
      pixels = ctx.getImageData(c.x - 16, c.y - 16, 32, 32).data;
    expect(Array.from(pixels).some((v, i) => i % 4 === 0 && v > 30)).toBe(true);
  });
  it("locks during a flare through rock, even though ordinary light sense fails", async () => {
    const { e } = await setup(1000 / 30);
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 2, 5));
    e.apply((s) => debug.addPredator(s, "flarefish", 5, 9));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    expect(lineClear(e.state, e.state.forager, e.state.predators[0])).toBe(
      false,
    );
    await e.advance(226);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].alert).toBe(true);
    expect(e.state.predators[0].flaring).toBe(false);
  });
  it("never reveals terrain or marks an amber creature with an enemy ping", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    e.apply((s) => debug.addPredator(s, "gloamfin", 5, 5));
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    e.apply((s) => debug.addPredator(s, "lanternjaw", 2, 5));
    e.apply((s) => debug.setPredatorMind(s, 1, false));
    e.apply((s) => debug.spawnDrifter(s, 3, 5));
    e.apply((s) => debug.setDrifterMind(s, 0, false));
    await e.advance(520);
    expect(e.state.visibility[5][2]).toBe("u");
    expect(e.state.predators.every((p) => !p.lit)).toBe(true);
    expect(e.state.drifters[0].lit).toBe(false);
  });
  it("does not resolve amber bodies with player sonar either", async () => {
    const { e, key } = await setup();
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 2, 5));
    e.apply((s) => debug.addPredator(s, "lanternjaw", 9, 5));
    e.apply((s) => debug.setPredatorMind(s, 0, false));
    e.apply((s) => debug.spawnDrifter(s, 8, 5));
    e.apply((s) => debug.setDrifterTravel(s, 0, false));
    key("Space");
    await e.advance(70);
    expect(e.state.visibility[5][9]).toBe("l");
    expect(e.state.predators[0].lit).toBe(false);
    expect(e.state.drifters[0].lit).toBe(false);
  });
  it("slows a chasing Gloamfin at corners and ramps back while its travel is disabled", async () => {
    const { e } = await setup();
    quiet(e);
    e.apply((s) => debug.setForagerTile(s, 5, 1));
    e.apply((s) => debug.addPredator(s, "gloamfin", 9, 5));
    e.apply((s) => debug.setPredatorDir(s, 0, "left"));
    e.apply((s) => debug.setPredatorState(s, 0, "chase"));
    e.apply((s) => debug.setForagerTile(s, 30, 5));
    await e.advance(122);
    expect(e.state.predators[0].dir).toBe("up");
    expect(e.state.predators[0].speed).toBeLessThan(C.FORAGER_SPEED);
    e.apply((s) => debug.setPredatorTravel(s, 0, false));
    await e.advance(240);
    expect(e.state.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("holds den hunters and admits no drifters on fixtures without a den", async () => {
    const { e } = await setup();
    e.apply((s) => debug.setMaze(s, fixture()));
    e.apply((s) => debug.clearPlankton(s));
    e.apply((s) => debug.setPlankton(s, 1, 5, true));
    e.apply((s) => debug.setForagerTile(s, 2, 5));
    e.apply((s) => debug.setDrifterIn(s, 0));
    e.apply((s) => debug.setScreen(s, "playing"));
    const positions = e.state.predators.map((p) => ({ x: p.x, y: p.y }));
    await e.advance(120);
    expect(e.state.predators.map((p) => ({ x: p.x, y: p.y }))).toEqual(
      positions,
    );
    expect(e.state.predators.every((p) => !p.lit)).toBe(true);
    expect(e.state.drifters).toHaveLength(0);
    expect(e.state.lives).toBe(C.START_LIVES);
  });
  it("does only the menu action when Space resumes, and allows Escape from game over", async () => {
    const { e, key } = await setup();
    quiet(e);
    e.apply((s) => debug.setScreen(s, "paused"));
    key("Space");
    await e.advance(1);
    expect(e.state.screen).toBe("playing");
    expect(e.state.pulses).toHaveLength(0);
    e.apply((s) => debug.setScreen(s, "gameover"));
    key("Escape");
    await e.advance(1);
    expect(e.state.screen).toBe("title");
  });
});
