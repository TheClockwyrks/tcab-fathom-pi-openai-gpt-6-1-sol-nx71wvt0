import * as C from "./constants";
import { arrive, center, put, reconcile, restart, roster } from "./state";
import type { Direction, FathomState, Predator, Pulse } from "./state";
import {
  choices,
  distance,
  flood,
  lineClear,
  open,
  refreshLight,
  route,
  segmentDistance,
  tile,
  travel,
  wander,
} from "./world";
// Clamp timer residue so an exact tick boundary is ready on that tick.
function down(value: number) {
  return value <= C.TICK_DT + 1e-9 ? 0 : value - C.TICK_DT;
}
export interface TickInput {
  held: Direction | null;
  sonar: boolean;
  ink: boolean;
}
export function acquire(s: FathomState, p: Predator) {
  if (p.state !== "chase") {
    p.alertLeft = p.kind === "lanternjaw" ? 0 : C.ALERT_TIME;
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flarePhase > 0) p.fade = 0.4;
    p.flarePhase = 0;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
  }
}
function drop(p: Predator) {
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flarePhase = 0;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
  }
}
function castPing(
  s: FathomState,
  p: Predator,
  index: number,
  tint: "violet" | "orange",
  cues: Set<C.CueName>,
) {
  s.pulses.push({
    source: "gloamfin",
    tint,
    ox: p.tx,
    oy: p.ty,
    front: 0,
    range: C.GLOAMFIN_PING_RANGE,
    owner: index,
    caught: false,
  });
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.pingGap = 0;
  cues.add(C.CUES.predatorPing);
}
function mind(
  s: FathomState,
  p: Predator,
  index: number,
  cues: Set<C.CueName>,
) {
  const dt = C.TICK_DT;
  if (!p.mind) return;
  p.alert = p.alertLeft > 0;
  p.fade = Math.max(0, p.fade - dt);
  if (p.state === "den") {
    if (!p.released || !s.tiles.some((r) => r.includes("d"))) return;
    const gy = s.tiles.findIndex((r) => r.includes("g")),
      gx = s.tiles[gy]?.indexOf("g") ?? -1;
    if (gx < 0) return;
    const exit = { tx: gx, ty: gy - 1 };
    if (p.travel)
      travel(s, p, C.PREDATOR_SPEED, () => route(s, p, exit, true), true);
    if (tile(s, p.tx, p.ty) === ".") p.state = "wander";
    return;
  }
  if (p.kind === "gloamfin") {
    const wasHearing = p.hearingLock;
    p.hearingLock = distance(s.forager, p) <= C.GLOAMFIN_HEAR;
    if (p.hearingLock) acquire(s, p);
    // Losing continuous hearing asks for a ping immediately; the shared
    // minimum gap still prevents it from firing too close to the last one.
    if (wasHearing && !p.hearingLock) p.pingIn = 0;
    p.pingIn = down(p.pingIn);
    p.pingGap += dt;
    const lost =
      p.state === "search" &&
      p.searchTime + 1e-9 >= C.GLOAMFIN_SEARCH_DELAY &&
      !p.searchPing;
    if (
      !p.hearingLock &&
      p.pingGap + 1e-9 >= C.GLOAMFIN_PING_MIN_GAP &&
      (lost || p.pingIn === 0)
    ) {
      castPing(s, p, index, lost ? "orange" : "violet", cues);
      if (lost) p.searchPing = true;
    }
    if (p.state === "chase") {
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * dt) /
            C.GLOAMFIN_RAMP_TIME,
      );
      if (
        p.fix &&
        p.tx === p.fix.tx &&
        p.ty === p.fix.ty &&
        !p.hearingLock &&
        !(p.tx === s.forager.tx && p.ty === s.forager.ty)
      ) {
        p.state = "search";
        p.searchTime = 0;
        p.searchPing = false;
      }
    }
    if (p.state === "search") {
      p.searchTime += dt;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) drop(p);
    }
  } else {
    const blind = s.inkClouds.some(
      (cloud) => segmentDistance(cloud, p, s.forager) <= cloud.radius,
    );
    const sensed =
      !blind &&
      ((distance(p, s.forager) <= (p.detectRange ?? 0) &&
        lineClear(s, p, s.forager)) ||
        (p.flaring && distance(p, s.forager) <= C.FLARE_RADIUS));
    if (blind) {
      if (p.state === "chase") drop(p);
    } else if (sensed) acquire(s, p);
    else if (p.state === "chase") {
      p.linger = down(p.linger);
      if (p.linger === 0) drop(p);
    }
    if (p.kind === "flarefish") {
      if (p.state === "wander" && p.flarePhase === 0) {
        p.flareIn = down(p.flareIn);
        if (p.flareIn === 0) {
          p.flarePhase = Number.EPSILON;
          p.flareCharging = true;
        }
      } else if (p.flarePhase > 0) {
        const before = p.flarePhase;
        p.flarePhase += dt;
        if (before < C.FLARE_CHARGE && p.flarePhase >= C.FLARE_CHARGE)
          cues.add(C.CUES.flare);
        p.flareCharging = p.flarePhase < C.FLARE_CHARGE;
        p.flaring = p.flarePhase >= C.FLARE_CHARGE;
        p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
        if (p.flarePhase >= C.FLARE_CHARGE + C.FLARE_BLOOM) {
          p.flarePhase = 0;
          p.flareCharging = false;
          p.flaring = false;
          p.flareRadius = 0;
          p.flareIn = C.FLARE_INTERVAL;
          p.fade = 0.4;
        }
      }
    }
  }
  p.alert = p.alertLeft > 0;
  if (!p.travel) return;
  const decide = (): Direction | null => {
    if (p.state === "chase" && p.fix) {
      if (p.tx === p.fix.tx && p.ty === p.fix.ty) return null;
      return route(s, p, p.fix);
    }
    if (p.state === "search" && p.fix) {
      const paths = flood(s, p.fix.tx, p.fix.ty);
      if (
        (paths.get(p.ty * C.GRID_COLS + p.tx) ?? Infinity) >=
        C.GLOAMFIN_SEARCH_ROAM
      )
        return route(s, p, p.fix);
    }
    return wander(s, p);
  };
  const old = p.dir;
  const reverse =
    p.state === "chase" && p.fix && (p.tx !== p.fix.tx || p.ty !== p.fix.ty)
      ? (route(s, p, p.fix) ?? undefined)
      : undefined;
  reconcile(s);
  travel(s, p, p.speed, decide, false, reverse);
  if (
    p.kind === "gloamfin" &&
    p.state === "chase" &&
    old !== p.dir &&
    (old === "up" || old === "down") !== (p.dir === "up" || p.dir === "down")
  )
    p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
}
function pulses(s: FathomState) {
  for (const pulse of s.pulses) {
    const before = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const paths = flood(s, pulse.ox, pulse.oy);
    const reached = (tx: number, ty: number) => {
      const d = paths.get(ty * C.GRID_COLS + tx);
      return (
        d !== undefined &&
        d >= before - 1e-8 &&
        d <= pulse.front &&
        d <= pulse.range
      );
    };
    if (pulse.source === "forager") {
      for (const [key, d] of paths) {
        if (d < before - 1e-8 || d > pulse.front || d > pulse.range) continue;
        s.marks[key] = C.SONAR_MARK_TIME;
        const x = key % C.GRID_COLS,
          y = Math.floor(key / C.GRID_COLS);
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ])
          if (
            tile(s, x + dx, y + dy) === "#" &&
            y + dy >= 0 &&
            y + dy < C.GRID_ROWS &&
            x + dx >= 0 &&
            x + dx < C.GRID_COLS
          )
            s.marks[(y + dy) * C.GRID_COLS + x + dx] = C.SONAR_MARK_TIME;
      }
      for (const p of s.predators)
        if (
          p.state !== "den" &&
          reached(p.tx, p.ty) &&
          p.kind !== "lanternjaw"
        ) {
          p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p);
        }
    } else if (!pulse.caught && reached(s.forager.tx, s.forager.ty)) {
      pulse.caught = true;
      const p = pulse.owner === null ? null : s.predators[pulse.owner];
      if (p && p.mind && p.state !== "den") acquire(s, p);
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
export function newPulse(s: FathomState): Pulse {
  return {
    source: "forager",
    tint: "cyan",
    ox: s.forager.tx,
    oy: s.forager.ty,
    front: 0,
    range: s.sonar.range,
    owner: null,
    caught: false,
  };
}
function loseLife(s: FathomState): FathomState {
  if (s.lives === 0) return arrive(s, "gameover");
  s.lives--;
  s.forager = {
    ...center(s.start.tx, s.start.ty),
    dir: "right",
    moving: false,
  };
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.playTime = 0;
  s.marks.fill(0);
  return arrive(reconcile(s), "countdown");
}
function releaseDue(s: FathomState) {
  // Release flags are the schedule, not decisions made by an individual mind.
  for (const p of s.predators)
    if (p.slot !== null && s.playTime + 1e-8 >= p.slot * C.DEN_RELEASE_GAP)
      p.released = true;
}
export function tick(
  s: FathomState,
  input: TickInput,
  cues: Set<C.CueName>,
): FathomState {
  const dt = C.TICK_DT;
  s.simTime += dt;
  s.screenTime += dt;
  if (s.screen === "countdown") {
    refreshLight(s);
    if (s.screenTime >= 2 - 1e-8) {
      arrive(s, "playing");
      s.playTime = 0;
      releaseDue(s);
    }
    return s;
  }
  if (s.screen === "cleared") {
    if (s.screenTime >= 2 - 1e-8) {
      const n = restart(s);
      n.depth = s.depth + 1;
      n.score = s.score;
      n.lives = s.lives;
      n.predators = roster(n.depth);
      return reconcile(n);
    }
    return s;
  }
  if (s.screen !== "playing") return s;
  s.playTime += dt;
  releaseDue(s);
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  s.marks = s.marks.map((t) => Math.max(0, t - dt));
  s.inkClouds = s.inkClouds
    .map((cloud) => ({ ...cloud, remaining: cloud.remaining - dt }))
    .filter((c) => c.remaining > 0);
  if (s.brightHold > 0) {
    const decay = Math.max(0, dt - s.brightHold);
    s.brightHold = Math.max(0, s.brightHold - dt);
    s.brightness *= 0.5 ** (decay / C.BRIGHT_HALFLIFE);
  } else s.brightness *= 0.5 ** (dt / C.BRIGHT_HALFLIFE);
  if (input.held) {
    s.desired = input.held;
    s.forager.moving = travel(
      s,
      s.forager,
      C.FORAGER_SPEED,
      () => {
        const dirs = choices(s, s.forager);
        return dirs.includes(s.desired)
          ? s.desired
          : dirs.includes(s.forager.dir)
            ? s.forager.dir
            : null;
      },
      false,
      s.desired,
    );
  } else s.forager.moving = false;
  if (input.sonar && s.sonar.cooldown === 0) {
    s.pulses.push(newPulse(s));
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (input.ink && s.ink.cooldown === 0) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  const f = s.forager;
  if (s.plankton[f.ty]?.[f.tx] === "*" && open(s, f.tx, f.ty)) {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      cues.add(C.CUES.descend);
      return arrive(reconcile(s), "cleared");
    }
  }
  // Effects age before new arrivals/acquisitions, so a fresh mark or alert
  // receives its full lifetime even when it was raised by a pulse this tick.
  for (const p of s.predators) {
    p.mark = down(p.mark);
    if (p.mind) p.alertLeft = down(p.alertLeft);
  }
  reconcile(s);
  pulses(s);
  for (let i = 0; i < s.predators.length; i++) mind(s, s.predators[i], i, cues);
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn === 0 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const gy = s.tiles.findIndex((r) => r.includes("g")),
      gx = s.tiles[gy]?.indexOf("g") ?? -1;
    if (gx >= 0 && open(s, gx, gy - 1)) {
      s.drifters.push({
        ...center(gx, gy - 1),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
      s.drifterIn = C.DRIFTER_INTERVAL;
    }
  }
  for (const b of s.drifters)
    if (b.mind && b.travel) travel(s, b, C.DRIFTER_SPEED, () => wander(s, b));
  s.drifters = s.drifters.filter((b) => {
    if (b.tx === f.tx && b.ty === f.ty) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  if (
    s.predators.some((p) => p.state !== "den" && p.tx === f.tx && p.ty === f.ty)
  ) {
    cues.add(C.CUES.caught);
    return loseLife(s);
  }
  reconcile(s);
  refreshLight(s);
  return s;
}
