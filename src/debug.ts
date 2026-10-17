import * as C from "./constants";
import {
  arrive,
  center,
  clone,
  DIRS,
  fresh,
  layer,
  makePredator,
  put,
  reconcile,
  roster,
} from "./state";
import type { Direction, FathomState, ReadState, Screen } from "./state";
import { open, tile } from "./world";
export function menuItems(s: ReadState): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuRect(s: ReadState, index: number) {
  return Number.isInteger(index) && index >= 0 && index < menuItems(s).length
    ? { x: 490, y: 405 + index * 62, w: 300, h: 50 }
    : null;
}
function valid(ok: boolean, message = "Invalid debug argument"): asserts ok {
  if (!ok) throw new RangeError(message);
}
function number(n: number, min = 0, max = Infinity, integer = false) {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
  );
}
function position(s: ReadState, x: number, y: number, den = false) {
  number(x, 0, C.GRID_COLS - 1, true);
  number(y, 0, C.GRID_ROWS - 1, true);
  valid(open(s, x, y, den), "Tile is closed");
}
function pose(s: ReadState, change: (s: FathomState) => void) {
  const n = clone(s);
  change(n);
  return reconcile(n);
}
function predator(s: FathomState, i: number) {
  number(i, 0, s.predators.length - 1, true);
  return s.predators[i];
}
function drifter(s: FathomState, i: number) {
  number(i, 0, s.drifters.length - 1, true);
  return s.drifters[i];
}
function direction(d: Direction) {
  valid(DIRS.includes(d));
}
function boolean(b: boolean) {
  valid(typeof b === "boolean");
}
export const debug = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s: ReadState) =>
    fresh(s.art as Record<string, ImageBitmap[]>, s.muted),
  snapshot: (s: ReadState) => ({
    version: s.version,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: s.planktonRemaining,
    drifterIn: s.drifterIn,
    brightness: s.brightness,
    brightHold: s.brightHold,
    visionRadius: s.visionRadius,
    windowRadius: s.windowRadius,
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    drifters: s.drifters.map((b) => ({
      x: b.x,
      y: b.y,
      tx: b.tx,
      ty: b.ty,
      lit: b.lit,
      mind: b.mind,
      travel: b.travel,
    })),
    predators: s.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: s.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: p.front,
      range: p.range,
    })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    simTime: s.simTime,
  }),
  reconcile: (s: ReadState) => reconcile(clone(s)),
  setScreen: (s: ReadState, screen: Screen) => {
    valid(
      [
        "title",
        "howto",
        "countdown",
        "playing",
        "paused",
        "cleared",
        "gameover",
      ].includes(screen),
    );
    return pose(s, (n) => {
      arrive(n, screen);
      if (screen === "playing") n.playTime = 0;
    });
  },
  setMenuIndex: (s: ReadState, index: number) => {
    number(index, 0, menuItems(s).length - 1, true);
    return pose(s, (n) => {
      n.menuIndex = index;
    });
  },
  setTitleIndex: (s: ReadState, index: number) => {
    number(index, 0, C.TITLE_ITEMS.length - 1, true);
    return pose(s, (n) => {
      n.titleIndex = index;
    });
  },
  menuItemRect: menuRect,
  setScore: (s: ReadState, points: number) => {
    number(points, 0, Infinity, true);
    return pose(s, (n) => {
      n.score = points;
    });
  },
  setLives: (s: ReadState, lives: number) => {
    number(lives, 0, Infinity, true);
    return pose(s, (n) => {
      n.lives = lives;
    });
  },
  setDepth: (s: ReadState, depth: number) => {
    number(depth, 1, Infinity, true);
    return pose(s, (n) => {
      n.depth = depth;
      n.predators = roster(depth);
      n.playTime = 0;
    });
  },
  setMaze: (s: ReadState, rows: readonly string[]) => {
    valid(
      rows.length === C.GRID_ROWS &&
        rows.every((r) => r.length === C.GRID_COLS && /^[#.gd]+$/.test(r)),
    );
    const all = rows.join("");
    valid(!/[dg]/.test(all) || [...all].filter((c) => c === "g").length === 1);
    return pose(s, (n) => {
      n.tiles = [...rows];
    });
  },
  setPlankton: (s: ReadState, tx: number, ty: number, present: boolean) => {
    position(s, tx, ty);
    boolean(present);
    return pose(s, (n) => put(n.plankton, tx, ty, present ? "*" : "-"));
  },
  clearPlankton: (s: ReadState) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s: ReadState) =>
    pose(s, (n) => {
      n.visibility = layer("u");
      n.marks = n.marks.map(() => 0);
    }),
  setForagerTile: (s: ReadState, tx: number, ty: number) => {
    position(s, tx, ty);
    return pose(s, (n) => {
      Object.assign(n.forager, center(tx, ty), { moving: false });
    });
  },
  setForagerDir: (s: ReadState, dir: Direction) => {
    direction(dir);
    return pose(s, (n) => {
      n.forager.dir = dir;
      n.desired = dir;
      n.forager.moving = false;
    });
  },
  setBrightness: (s: ReadState, g: number) => {
    number(g, 0, 1);
    return pose(s, (n) => {
      n.brightness = g;
    });
  },
  setBrightHold: (s: ReadState, seconds: number) => {
    number(seconds, 0, C.BRIGHT_HOLD);
    return pose(s, (n) => {
      n.brightHold = seconds;
    });
  },
  clearPredators: (s: ReadState) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s: ReadState, kind: C.PredatorKind, tx: number, ty: number) => {
    valid(C.DEN_ORDER.includes(kind));
    position(s, tx, ty);
    return pose(s, (n) => {
      n.predators.push(makePredator(kind, tx, ty));
    });
  },
  setPredatorTile: (s: ReadState, index: number, tx: number, ty: number) => {
    position(s, tx, ty, true);
    return pose(s, (n) => {
      Object.assign(predator(n, index), center(tx, ty));
    });
  },
  setPredatorDir: (s: ReadState, index: number, dir: Direction) => {
    direction(dir);
    return pose(s, (n) => {
      predator(n, index).dir = dir;
    });
  },
  setPredatorState: (
    s: ReadState,
    index: number,
    value: "den" | "wander" | "chase",
  ) => {
    valid(["den", "wander", "chase"].includes(value));
    return pose(s, (n) => {
      const p = predator(n, index);
      valid(
        value === "den"
          ? ["d", "g"].includes(tile(n, p.tx, p.ty))
          : tile(n, p.tx, p.ty) === ".",
      );
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = value === "chase" ? C.LINGER_TIME : 0;
      p.alert = false;
      p.alertLeft = 0;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    });
  },
  setPredatorReleased: (s: ReadState, index: number, released: boolean) => {
    boolean(released);
    return pose(s, (n) => {
      predator(n, index).released = released;
    });
  },
  setPredatorMind: (s: ReadState, index: number, enabled: boolean) => {
    boolean(enabled);
    return pose(s, (n) => {
      predator(n, index).mind = enabled;
    });
  },
  setPredatorTravel: (s: ReadState, index: number, enabled: boolean) => {
    boolean(enabled);
    return pose(s, (n) => {
      predator(n, index).travel = enabled;
    });
  },
  spawnDrifter: (s: ReadState, tx: number, ty: number) => {
    position(s, tx, ty);
    return pose(s, (n) => {
      n.drifters.push({
        ...center(tx, ty),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
    });
  },
  clearDrifters: (s: ReadState) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s: ReadState, index: number, enabled: boolean) => {
    boolean(enabled);
    return pose(s, (n) => {
      drifter(n, index).mind = enabled;
    });
  },
  setDrifterTravel: (s: ReadState, index: number, enabled: boolean) => {
    boolean(enabled);
    return pose(s, (n) => {
      drifter(n, index).travel = enabled;
    });
  },
  setDrifterIn: (s: ReadState, seconds: number) => {
    number(seconds, 0, C.DRIFTER_INTERVAL);
    return pose(s, (n) => {
      n.drifterIn = seconds;
    });
  },
  setSonarCooldown: (s: ReadState, seconds: number) => {
    number(seconds);
    return pose(s, (n) => {
      n.sonar.cooldown = seconds;
    });
  },
  setInkCooldown: (s: ReadState, seconds: number) => {
    number(seconds);
    return pose(s, (n) => {
      n.ink.cooldown = seconds;
    });
  },
};
export type FathomDebugApi = typeof debug;
