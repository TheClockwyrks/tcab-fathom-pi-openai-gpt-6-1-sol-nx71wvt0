import * as C from "./constants";
import type { Direction, ReadState } from "./state";
import { center } from "./state";
import { menuItems, menuRect } from "./debug";
import { distance, flood, lineClear, tile } from "./world";
export const BACKGROUND = "#03060c";
const CYAN = "#8af7ee",
  DIM = "#527780",
  WHITE = "#dcf6ee",
  AMBER = "#ff9869",
  VIOLET = "#bd96ff";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size = 14,
  color = DIM,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}
function line(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#19343e",
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string | CanvasGradient,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  disc(ctx, x, y, r, g);
}
function sprite(
  s: ReadState,
  ctx: CanvasRenderingContext2D,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  w = C.TILE,
  h = w,
) {
  const image = s.art[sheet]?.[frame];
  if (image) ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
}
function facing(dir: Direction) {
  return { down: 0, up: 2, left: 4, right: 6 }[dir];
}
function terrainFrame(s: ReadState, x: number, y: number) {
  if (tile(s, x, y) === "g") return 18;
  if (tile(s, x, y) !== "#") return 16;
  return (
    (tile(s, x, y - 1) === "#" ? 1 : 0) +
    (tile(s, x + 1, y) === "#" ? 2 : 0) +
    (tile(s, x, y + 1) === "#" ? 4 : 0) +
    (tile(s, x - 1, y) === "#" ? 8 : 0)
  );
}
function terrain(s: ReadState, ctx: CanvasRenderingContext2D, title = false) {
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const v = s.visibility[y][x];
      if (!title && v === "u") {
        const c = center(x, y);
        sprite(s, ctx, "trench-walls", 17, c.x, c.y);
        continue;
      }
      const c = center(x, y);
      ctx.globalAlpha = title ? 0.44 : v === "l" ? 1 : 0.25;
      sprite(s, ctx, "trench-walls", terrainFrame(s, x, y), c.x, c.y);
      if (s.plankton[y][x] === "*") {
        ctx.globalAlpha = title ? 0.35 : v === "l" ? 0.95 : 0.3;
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = v === "l" ? 9 : 0;
        disc(ctx, c.x, c.y, C.PLANKTON_DOT / 2, CYAN);
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function amber(ctx: CanvasRenderingContext2D, x: number, y: number) {
  glow(ctx, x, y, 18, "#fd6c373b");
  ctx.shadowColor = AMBER;
  ctx.shadowBlur = 10;
  disc(ctx, x, y, 2.6, "#ffb27e");
  ctx.shadowBlur = 0;
}
function mazeView(s: ReadState, ctx: CanvasRenderingContext2D) {
  const f = s.forager;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, s.windowRadius, 0, Math.PI * 2);
  for (const p of s.predators)
    if (p.flaring) {
      ctx.moveTo(p.x + C.FLARE_RADIUS, p.y);
      ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
    }
  ctx.clip();
  terrain(s, ctx);
  glow(ctx, f.x, f.y, s.windowRadius, "#35bca40d");
  for (const b of s.drifters) {
    if (b.lit)
      sprite(s, ctx, "drifter", Math.floor(s.playTime * 8) % 8, b.x, b.y);
    amber(ctx, b.x, b.y);
  }
  for (const p of s.predators)
    if (p.state !== "den" && p.kind === "lanternjaw") amber(ctx, p.x, p.y);
  ctx.restore();
  for (const cloud of s.inkClouds) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, cloud.remaining);
    glow(ctx, cloud.x, cloud.y, cloud.radius, "#000107f5");
    disc(ctx, cloud.x, cloud.y, cloud.radius * 0.7, "#000207d9");
    ctx.strokeStyle = "#183039";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.lit) {
      ctx.save();
      const directlyLit =
        distance(p, f) <= s.visionRadius && lineClear(s, f, p);
      const inFlare = s.predators.some(
        (flare) => flare.flaring && distance(p, flare) <= C.FLARE_RADIUS,
      );
      if (p.mark > 0 && !p.alert && !directlyLit && !inFlare)
        ctx.globalAlpha = Math.min(1, p.mark / 0.45);
      if (p.kind === "lanternjaw" && p.state === "wander")
        sprite(
          s,
          ctx,
          "lanternjaw",
          8 + (Math.floor(s.playTime * 8) % 8),
          p.x,
          p.y,
        );
      else
        sprite(
          s,
          ctx,
          p.kind,
          facing(p.dir) + (Math.floor(s.playTime * 7) % 2),
          p.x,
          p.y,
        );
      ctx.restore();
    }
    if (p.alert) {
      const t = 1 - p.alertLeft / C.ALERT_TIME,
        color = p.kind === "gloamfin" ? VIOLET : AMBER;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17 + t * 24, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          ctx,
          p.x + Math.cos(a) * 20,
          p.y + Math.sin(a) * 20,
          p.x + Math.cos(a) * (30 + t * 20),
          p.y + Math.sin(a) * (30 + t * 20),
          color,
        );
      }
      ctx.restore();
    }
  }
  for (const p of s.predators)
    if (p.kind === "flarefish" && (p.flarePhase > 0 || p.fade > 0)) {
      const frame =
        p.fade > 0
          ? p.fade > 0.2
            ? 6
            : 7
          : p.flareCharging
            ? Math.min(2, Math.floor((p.flarePhase / C.FLARE_CHARGE) * 3))
            : 3 +
              Math.min(
                2,
                Math.floor(
                  ((p.flarePhase - C.FLARE_CHARGE) / C.FLARE_BLOOM) * 3,
                ),
              );
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      sprite(s, ctx, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
      ctx.restore();
    }
  for (const pulse of s.pulses) {
    const paths = flood(s, pulse.ox, pulse.oy);
    const color =
      pulse.tint === "cyan"
        ? CYAN
        : pulse.tint === "violet"
          ? VIOLET
          : "#ff9a50";
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    for (const [key, d] of paths) {
      const gap = pulse.front - d;
      if (gap < -0.3 || gap > 1.7 || d > pulse.range) continue;
      const c = center(key % C.GRID_COLS, Math.floor(key / C.GRID_COLS));
      ctx.globalAlpha = (1 - Math.max(0, gap) / 1.7) * 0.75;
      ctx.fillStyle = color;
      ctx.fillRect(c.x - 12, c.y - 12, 24, 24);
      ctx.globalAlpha *= 0.6;
      ctx.strokeStyle = color;
      ctx.strokeRect(c.x - 15, c.y - 15, 30, 30);
    }
    ctx.restore();
  }
  glow(ctx, f.x, f.y, 36, "#5bffe639");
  sprite(
    s,
    ctx,
    "glimmerfin",
    facing(f.dir) + (f.moving ? Math.floor(s.playTime * 9) % 2 : 0),
    f.x,
    f.y,
  );
  ctx.restore();
  // Fine corner marks frame the water, without outlining unrevealed rock.
  for (const [x, y, dx, dy] of [
    [64, 80, 1, 1],
    [1216, 80, -1, 1],
    [64, 656, 1, -1],
    [1216, 656, -1, -1],
  ]) {
    line(ctx, x, y, x + dx * 16, y);
    line(ctx, x, y, x, y + dy * 16);
  }
}
function gauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  label: string,
  key: string,
  cooldown: number,
  total: number,
) {
  const ready = cooldown === 0;
  const color = ready ? CYAN : DIM;
  text(ctx, key, x, 684, 12, color);
  text(ctx, label, x + 50, 684, 13, color);
  text(
    ctx,
    ready ? "READY" : `${cooldown.toFixed(1)}s`,
    x + 228,
    684,
    11,
    color,
    "right",
  );
  ctx.fillStyle = "#10242c";
  ctx.fillRect(x, 696, 228, 3);
  ctx.fillStyle = ready ? CYAN : "#326470";
  ctx.fillRect(x, 696, 228 * Math.max(0, 1 - cooldown / total), 3);
}
function hud(s: ReadState, ctx: CanvasRenderingContext2D) {
  text(ctx, C.TITLE_TEXT, 64, 39, 23, CYAN);
  text(
    ctx,
    `${C.DIVE_LABEL}  /  DIVE ${String(s.depth).padStart(2, "0")}`,
    65,
    61,
    11,
    DIM,
  );
  text(ctx, "SCORE", 425, 31, 10, DIM);
  text(ctx, String(s.score).padStart(6, "0"), 425, 69, 42, WHITE);
  text(ctx, "PLANKTON", 932, 32, 10, DIM);
  text(ctx, String(s.planktonRemaining).padStart(3, "0"), 932, 61, 26, WHITE);
  text(
    ctx,
    s.muted ? "M / SOUND OFF" : "M / SOUND ON",
    1216,
    31,
    11,
    DIM,
    "right",
  );
  text(ctx, "ESC / PAUSE", 1216, 58, 11, DIM, "right");
  line(ctx, 64, 73, 1216, 73);
  line(ctx, 64, 663, 1216, 663);
  text(ctx, `DEPTH ${String(s.depth).padStart(2, "0")}`, 64, 692, 18, WHITE);
  for (let i = 0; i < s.lives; i++)
    sprite(s, ctx, "glimmerfin", 6, 226 + i * 29, 688, 24);
  gauge(ctx, 441, "SONAR", "SPACE", s.sonar.cooldown, C.SONAR_COOLDOWN);
  gauge(ctx, 746, "INK", "SHIFT", s.ink.cooldown, C.INK_COOLDOWN);
  text(ctx, "WASD / SWIM", 1216, 692, 12, DIM, "right");
}
function menu(s: ReadState, ctx: CanvasRenderingContext2D) {
  const items = menuItems(s);
  items.forEach((item, i) => {
    const r = menuRect(s, i)!;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#102d35" : "#06151c";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#3dafa5" : "#15313b";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y, 3, r.h);
    }
    text(
      ctx,
      selected ? "›" : "·",
      r.x + 20,
      r.y + 33,
      24,
      selected ? CYAN : DIM,
    );
    text(ctx, item, r.x + 50, r.y + 32, 17, selected ? WHITE : DIM);
    text(
      ctx,
      `0${i + 1}`,
      r.x + r.w - 18,
      r.y + 31,
      11,
      selected ? CYAN : DIM,
      "right",
    );
  });
}
function title(s: ReadState, ctx: CanvasRenderingContext2D) {
  text(ctx, "F / 01", 64, 53, 15, CYAN);
  text(ctx, "ABYSSAL FIELD NOTES", 150, 53, 11, DIM);
  text(ctx, "36° N  /  NO SIGNAL", 1216, 53, 11, DIM, "right");
  line(ctx, 64, 72, 1216, 72);
  ctx.save();
  ctx.beginPath();
  ctx.arc(640, 338, 282, 0, Math.PI * 2);
  ctx.clip();
  terrain(s, ctx, true);
  ctx.fillStyle = "#02090f94";
  ctx.fillRect(64, 80, 1152, 576);
  ctx.restore();
  for (const r of [196, 282, 304]) {
    ctx.strokeStyle = r === 282 ? "#21454e" : "#10242d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(640, 338, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  line(ctx, 320, 338, 365, 338);
  line(ctx, 915, 338, 960, 338);
  line(ctx, 640, 20, 640, 53);
  line(ctx, 640, 622, 640, 659);
  glow(ctx, 640, 255, 270, "#197e7122");
  text(
    ctx,
    "IN THE ABYSS, YOUR LIGHT IS A LIABILITY.",
    640,
    161,
    11,
    "#6c9b9f",
    "center",
  );
  ctx.save();
  ctx.shadowColor = "#45c9bd";
  ctx.shadowBlur = 28;
  text(ctx, C.TITLE_TEXT, 640, 281, 104, WHITE, "center");
  ctx.restore();
  text(ctx, C.TAGLINE_TEXT.split("").join(" "), 640, 322, 17, CYAN, "center");
  text(ctx, "A BIOLUMINESCENT MAZE CHASE", 640, 367, 10, DIM, "center");
  menu(s, ctx);
  text(ctx, "01 — GRAZE", 102, 285, 12, CYAN);
  text(ctx, "Feed your light.", 102, 311, 12, DIM);
  text(ctx, "But light draws teeth.", 102, 333, 12, DIM);
  text(ctx, "02 — LISTEN", 963, 285, 12, CYAN);
  text(ctx, "Sound finds a way.", 963, 311, 12, DIM);
  text(ctx, "So do the hunters.", 963, 333, 12, DIM);
  sprite(s, ctx, "glimmerfin", 6, 640, 589);
  glow(ctx, 640, 589, 32, "#45ffcf26");
  text(ctx, "↑ ↓  SELECT    ENTER  CONFIRM", 640, 650, 11, DIM, "center");
  line(ctx, 64, 674, 1216, 674);
  text(ctx, "KINDLE", 64, 699, 11, CYAN);
  text(ctx, "REMEMBER THE WAY. FEAR THE GLOW.", 640, 699, 10, DIM, "center");
  text(
    ctx,
    s.muted ? "M / MUTED" : "M / SOUND ON",
    1216,
    699,
    11,
    DIM,
    "right",
  );
}
function howto(s: ReadState, ctx: CanvasRenderingContext2D) {
  text(ctx, "F / FIELD GUIDE", 64, 52, 13, CYAN);
  text(ctx, "THE DARK IS NOT EMPTY.", 64, 125, 42, WHITE);
  text(
    ctx,
    "Eat the plankton. Read the water. Make it to the next depth.",
    64,
    163,
    16,
    DIM,
  );
  const cards = [
    {
      name: "LANTERNJAW",
      sheet: "lanternjaw",
      label: "HUNTS YOUR LIGHT",
      color: AMBER,
      lines: [
        "An amber glimmer may be food.",
        "Or jaws. Brightness draws it in.",
        "Ink breaks its line of sight.",
      ],
    },
    {
      name: "GLOAMFIN",
      sheet: "gloamfin",
      label: "HUNTS YOUR SOUND",
      color: VIOLET,
      lines: [
        "Violet ripples carry a question.",
        "Your sonar gives it an answer.",
        "Round corners to lose its pace.",
      ],
    },
    {
      name: "FLAREFISH",
      sheet: "flarefish",
      label: "HUNTS IN THE FLASH",
      color: "#ffbe84",
      lines: [
        "A warm charge. A sudden bloom.",
        "Its flash sees straight through rock.",
        "Leave before the light finds you.",
      ],
    },
  ];
  cards.forEach((card, i) => {
    const x = 64 + i * 392;
    ctx.fillStyle = "#071820";
    ctx.fillRect(x, 208, 368, 221);
    line(ctx, x, 208, x + 368, 208, card.color);
    sprite(s, ctx, card.sheet, 6, x + 37, 246);
    text(ctx, card.name, x + 70, 243, 19, card.color);
    text(ctx, card.label, x + 70, 267, 10, DIM);
    card.lines.forEach((v, j) => text(ctx, v, x + 24, 322 + j * 28, 13, WHITE));
  });
  text(ctx, "CARRY A SMALL LIGHT", 64, 482, 16, CYAN);
  text(
    ctx,
    "Eating makes your light grow — and makes you easier to find.",
    64,
    514,
    14,
    WHITE,
  );
  text(
    ctx,
    "Sonar remembers corridors around corners. Beyond your circle, even memory goes dark.",
    64,
    543,
    14,
    DIM,
  );
  const controls = [
    ["WASD / ARROWS", "Swim"],
    ["SPACE", "Send sonar"],
    ["SHIFT", "Drop ink"],
    ["ESC / P", "Pause"],
    ["M", "Mute"],
  ];
  controls.forEach(([key, label], i) => {
    const x = 64 + i * 234;
    text(ctx, key, x, 604, 13, CYAN);
    text(ctx, label, x, 629, 13, DIM);
  });
  line(ctx, 64, 659, 1216, 659);
  text(
    ctx,
    "ENTER / ESC / CLICK ANYWHERE TO RETURN",
    640,
    696,
    12,
    DIM,
    "center",
  );
}
export function render(s: ReadState, ctx: CanvasRenderingContext2D) {
  ctx.imageSmoothingEnabled = false;
  if (s.screen === "title") {
    title(s, ctx);
    return;
  }
  if (s.screen === "howto") {
    howto(s, ctx);
    return;
  }
  if (s.screen !== "gameover") {
    mazeView(s, ctx);
    hud(s, ctx);
  }
  if (s.screen === "playing") return;
  if (s.screen === "countdown" || s.screen === "cleared") {
    ctx.fillStyle = "#02090fc4";
    ctx.fillRect(430, 269, 420, 150);
    line(ctx, 480, 270, 800, 270, "#2a656b");
    text(
      ctx,
      s.screen === "cleared" ? `DEPTH ${s.depth} CLEARED` : C.TITLE_ITEMS[0],
      640,
      330,
      s.screen === "cleared" ? 28 : 40,
      WHITE,
      "center",
    );
    text(
      ctx,
      s.screen === "cleared"
        ? `+${C.SCORE_CLEAR}  /  DESCENDING`
        : `${Math.max(1, Math.ceil(2 - s.screenTime))}   —   HOLD YOUR BREATH`,
      640,
      375,
      13,
      CYAN,
      "center",
    );
    return;
  }
  ctx.fillStyle = "#02090fe8";
  ctx.fillRect(0, 80, C.STAGE_W, 576);
  text(
    ctx,
    s.screen === "paused" ? "SUSPENDED" : "LOST TO THE DEEP",
    640,
    263,
    48,
    WHITE,
    "center",
  );
  text(
    ctx,
    s.screen === "paused"
      ? "THE WATER CAN WAIT."
      : `SCORE ${String(s.score).padStart(6, "0")}  /  DEPTH ${s.depth}`,
    640,
    309,
    15,
    CYAN,
    "center",
  );
  text(
    ctx,
    s.screen === "paused" ? C.TITLE_TEXT : "ANOTHER LIGHT GOES OUT.",
    640,
    355,
    11,
    DIM,
    "center",
  );
  menu(s, ctx);
  text(ctx, "↑ ↓  SELECT    ENTER  CONFIRM", 640, 641, 11, DIM, "center");
}
