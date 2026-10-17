import * as C from "./constants";
import { center, DELTA, DIRS, locate, OPPOSITE, put, random } from "./state";
import type { Body, Direction, FathomState, ReadState } from "./state";
export function tile(s: ReadState, x: number, y: number) {
  return s.tiles[y]?.[x] ?? "#";
}
export function wrapRow(s: ReadState) {
  return s.tiles.findIndex((r) => r[0] === "." && r[C.GRID_COLS - 1] === ".");
}
export function neighbor(s: ReadState, x: number, y: number, d: Direction) {
  const [dx, dy] = DELTA[d];
  let nx = x + dx;
  const ny = y + dy;
  if (y === wrapRow(s)) nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  return { tx: nx, ty: ny };
}
export function open(s: ReadState, x: number, y: number, den = false) {
  const t = tile(s, x, y);
  return t === "." || (den && (t === "d" || t === "g"));
}
export function choices(s: ReadState, b: Body, den = false) {
  return DIRS.filter((d) => {
    const n = neighbor(s, b.tx, b.ty, d);
    return open(s, n.tx, n.ty, den);
  });
}
export function flood(
  s: ReadState,
  tx: number,
  ty: number,
  den = false,
): Map<number, number> {
  const distances = new Map<number, number>();
  if (!open(s, tx, ty, den)) return distances;
  const queue = [{ tx, ty }];
  distances.set(ty * C.GRID_COLS + tx, 0);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i],
      distance = distances.get(p.ty * C.GRID_COLS + p.tx)!;
    for (const d of DIRS) {
      const n = neighbor(s, p.tx, p.ty, d),
        key = n.ty * C.GRID_COLS + n.tx;
      if (open(s, n.tx, n.ty, den) && !distances.has(key)) {
        distances.set(key, distance + 1);
        queue.push(n);
      }
    }
  }
  return distances;
}
export function route(
  s: ReadState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  const dist = flood(s, target.tx, target.ty, den);
  let best = Infinity;
  let result: Direction | null = null;
  for (const d of choices(s, b, den)) {
    const n = neighbor(s, b.tx, b.ty, d),
      v = dist.get(n.ty * C.GRID_COLS + n.tx) ?? Infinity;
    if (v < best) {
      best = v;
      result = d;
    }
  }
  return result;
}
export function wander(s: FathomState, b: Body, den = false): Direction | null {
  let dirs = choices(s, b, den);
  const forward = dirs.filter((d) => d !== OPPOSITE[b.dir]);
  if (forward.length) dirs = forward;
  return dirs.length ? dirs[Math.floor(random(s) * dirs.length)] : null;
}
/** Integrate along center lines, splitting at centers so turns never cut rock. */
export function travel(
  s: FathomState,
  b: Body,
  speed: number,
  decide: () => Direction | null,
  den = false,
  reverse?: Direction,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  if (reverse === OPPOSITE[b.dir]) b.dir = reverse;
  let remaining = speed * C.TICK_DT,
    moved = false;
  while (remaining > 1e-8) {
    const c = center(b.tx, b.ty);
    const atCenter = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (atCenter) {
      b.x = c.x;
      b.y = c.y;
      const d = decide();
      if (!d) break;
      const n = neighbor(s, b.tx, b.ty, d);
      if (!open(s, n.tx, n.ty, den)) break;
      b.dir = d;
    }
    const [dx, dy] = DELTA[b.dir];
    const coordinate = dx ? b.x : b.y,
      origin = dx ? C.GRID_ORIGIN_X : C.GRID_ORIGIN_Y,
      sign = dx || dy;
    const cell = (coordinate - origin - C.TILE / 2) / C.TILE;
    const next =
      sign > 0 ? Math.floor(cell + 1e-8) + 1 : Math.ceil(cell - 1e-8) - 1;
    const distance = Math.abs(origin + C.TILE / 2 + next * C.TILE - coordinate);
    const step = Math.min(remaining, distance);
    b.x += dx * step;
    b.y += dy * step;
    remaining -= step;
    moved = true;
    if (b.x < C.GRID_ORIGIN_X) b.x += C.GRID_COLS * C.TILE;
    if (b.x >= C.GRID_ORIGIN_X + C.GRID_COLS * C.TILE)
      b.x -= C.GRID_COLS * C.TILE;
    locate(b);
  }
  return moved;
}
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function lineClear(
  s: ReadState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  targetRock = false,
) {
  // Traverse grid crossings exactly: fixed-distance samples can miss a thin
  // slice of rock near a corner. At a corner, test both adjoining faces.
  let x = Math.floor((a.x - C.GRID_ORIGIN_X) / C.TILE);
  let y = Math.floor((a.y - C.GRID_ORIGIN_Y) / C.TILE);
  const tx = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE);
  const ty = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  const stepX = dx === 0 ? Infinity : C.TILE / Math.abs(dx);
  const stepY = dy === 0 ? Infinity : C.TILE / Math.abs(dy);
  let crossX =
    dx === 0
      ? Infinity
      : (C.GRID_ORIGIN_X + (x + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx;
  let crossY =
    dy === 0
      ? Infinity
      : (C.GRID_ORIGIN_Y + (y + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy;
  const blocked = (cx: number, cy: number) =>
    !(targetRock && cx === tx && cy === ty) && tile(s, cx, cy) === "#";
  if (blocked(x, y)) return false;
  while (x !== tx || y !== ty) {
    if (crossX < crossY - 1e-10) {
      x += sx;
      crossX += stepX;
    } else if (crossY < crossX - 1e-10) {
      y += sy;
      crossY += stepY;
    } else {
      if (blocked(x + sx, y) || blocked(x, y + sy)) return false;
      x += sx;
      y += sy;
      crossX += stepX;
      crossY += stepY;
    }
    if (blocked(x, y)) return false;
  }
  return true;
}
export function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function refreshLight(s: FathomState) {
  const lit = new Set<number>(),
    passive = new Set<number>(),
    flared = new Set<number>();
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const c = center(x, y),
        key = y * C.GRID_COLS + x;
      if (
        distance(c, s.forager) <= s.visionRadius &&
        lineClear(s, s.forager, c, true)
      ) {
        lit.add(key);
        passive.add(key);
      }
      if (
        s.predators.some((p) => p.flaring && distance(c, p) <= C.FLARE_RADIUS)
      ) {
        lit.add(key);
        flared.add(key);
      }
      if (s.marks[key] > 0) lit.add(key);
      put(
        s.visibility,
        x,
        y,
        lit.has(key) ? "l" : s.visibility[y][x] === "u" ? "u" : "r",
      );
    }
  for (const b of [...s.drifters, ...s.predators]) {
    const key = b.ty * C.GRID_COLS + b.tx;
    b.lit = passive.has(key) || flared.has(key);
  }
  for (const p of s.predators) {
    p.lit = p.state !== "den" && (p.lit || p.mark > 0 || p.alert);
  }
}
