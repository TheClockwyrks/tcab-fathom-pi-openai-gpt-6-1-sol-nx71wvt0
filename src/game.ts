import type { Game } from "@clockwyrks/simple-2d";
import "./stage.css";
import * as C from "./constants";
import { debug, menuItems, menuRect } from "./debug";
import { arrive, clone, DIRS, fresh, restart } from "./state";
import type { FathomState } from "./state";
import type { FathomDebugApi } from "./debug";
import { tick } from "./simulation";
import { render } from "./render";
export { BACKGROUND } from "./render";
export type {
  FathomState,
  Direction,
  Screen,
  Body,
  Forager,
  Predator,
  Drifter,
  Pulse,
  InkCloud,
} from "./state";
export type { FathomDebugApi } from "./debug";
function confirm(s: FathomState): FathomState {
  const index = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = index ?? 0;
    return index === 0 ? restart(s) : arrive(s, "howto");
  }
  if (s.screen === "paused") {
    return index === 0
      ? arrive(s, "playing")
      : index === 1
        ? restart(s)
        : restart(s, "title");
  }
  if (s.screen === "gameover")
    return index === 0 ? restart(s) : restart(s, "title");
  return s;
}
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const action of C.ACTIONS)
      api.input.register(action, { keys: [...C.BINDINGS[action]] });
    const sounds = [
      { freq: 640, freqTo: 980, durationMs: 55, gain: 0.07 },
      { freq: 840, freqTo: 150, durationMs: 430, gain: 0.13 },
      { freq: 95, freqTo: 34, durationMs: 290, gain: 0.18 },
      { freq: 360, freqTo: 130, durationMs: 550, gain: 0.12 },
      { freq: 120, freqTo: 940, durationMs: 320, gain: 0.13 },
      { freq: 240, freqTo: 32, durationMs: 650, gain: 0.18 },
      { freq: 380, freqTo: 1250, durationMs: 750, gain: 0.13 },
    ];
    Object.values(C.CUES).forEach((cue, i) =>
      api.audio.define(cue, {
        ...sounds[i],
        wave: i === 2 ? "triangle" : "sine",
      }),
    );
    const art: Record<string, ImageBitmap[]> = {};
    await Promise.all(
      Object.entries({
        glimmerfin: 8,
        lanternjaw: 16,
        gloamfin: 8,
        flarefish: 8,
        drifter: 8,
        "flare-bloom": 8,
        "trench-walls": 19,
      }).map(async ([sheet, count]) => {
        art[sheet] = await Promise.all(
          Array.from({ length: count }, (_, i) =>
            api.assets.loadImage(`${sheet}/${i}.png`),
          ),
        );
      }),
    );
    for (const key of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(key, (s) => s[key]);
    api.diagnostics.register("sonar cooldown", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink cooldown", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`hunter ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "none";
      });
    return [fresh(art), debug];
  },
  update(state, api, dt) {
    let s = clone(state);
    if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
    s.muted = api.audio.muted();
    let clicked = false;
    for (const sample of api.input.pointerSamples()) {
      if (!sample.primary) continue;
      const hit = menuItems(s).findIndex((_, i) => {
        const r = menuRect(s, i)!;
        return (
          sample.x >= r.x &&
          sample.x <= r.x + r.w &&
          sample.y >= r.y &&
          sample.y <= r.y + r.h
        );
      });
      if (hit >= 0) s.menuIndex = hit;
      if (sample.type === "down") {
        s.pointerItem = hit;
        s.pointerId = sample.id;
      }
      if (sample.type === "up") {
        clicked =
          s.pointerId === sample.id &&
          (s.screen === "howto" || (hit >= 0 && hit === s.pointerItem));
        s.pointerItem = null;
        s.pointerId = null;
      }
    }
    if (s.screen === "playing") {
      if (api.input.pressed("pause")) s = arrive(s, "paused");
    } else if (
      s.screen === "paused" &&
      (api.input.pressed("pause") || api.input.pressed("back"))
    )
      s = arrive(s, "playing");
    else if (s.screen === "howto") {
      if (api.input.pressed("confirm") || api.input.pressed("back") || clicked)
        s = restart(s, "title");
    } else if (menuItems(s).length) {
      const count = menuItems(s).length;
      if (api.input.pressed("up"))
        s.menuIndex = ((s.menuIndex ?? 0) + count - 1) % count;
      if (api.input.pressed("down"))
        s.menuIndex = ((s.menuIndex ?? 0) + 1) % count;
      if (s.screen === "gameover" && api.input.pressed("back"))
        s = restart(s, "title");
      else if (api.input.pressed("confirm") || clicked) s = confirm(s);
    }
    const held = DIRS.filter((d) => api.input.value(d) > 0);
    // A newly held direction supersedes the buffered one; holding no direction stops travel.
    const newDirection = held.find((d) => !s.held.includes(d));
    const desired =
      newDirection ??
      (held.includes(s.desired) ? s.desired : (held[0] ?? null));
    s.held = held;
    const liveInput = state.screen === "playing" && s.screen === "playing";
    s.pendingSonar ||= liveInput && api.input.pressed("a");
    s.pendingInk ||= liveInput && api.input.pressed("b");
    s.accumulator += dt;
    while (s.accumulator + 1e-10 >= C.TICK_DT) {
      s.accumulator = Math.max(0, s.accumulator - C.TICK_DT);
      const cues = new Set<C.CueName>();
      s = tick(
        s,
        { held: desired, sonar: s.pendingSonar, ink: s.pendingInk },
        cues,
      );
      s.pendingSonar = false;
      s.pendingInk = false;
      for (const cue of cues) api.audio.play(cue);
    }
    return s;
  },
  render(state, api) {
    render(state, api.ctx);
  },
};
