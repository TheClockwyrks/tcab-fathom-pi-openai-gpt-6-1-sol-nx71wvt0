/* global document, KeyboardEvent */
// Run `npm run dev` first. This driver keeps its engine inside the browser
// evaluation; no automation handle or debug globals ship on the game page.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import console from "node:console";

await mkdir("showcase", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("http://localhost:5173");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "showcase/title.png" });
  const capture = await page.evaluate(async () => {
    const { createEngine, ConstantClock } =
      await import("/node_modules/@clockwyrks/simple-2d/dist/index.js");
    const { game, BACKGROUND } = await import("/src/game.ts");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh";
    document.body.append(canvas);
    const engine = createEngine({
      canvas,
      width: 1280,
      height: 720,
      background: BACKGROUND,
      game,
      clock: new ConstantClock(1000 / 30),
    });
    await engine.initialize();
    const debug = engine.debug;
    const key = (code, down = true) =>
      document.dispatchEvent(
        new KeyboardEvent(down ? "keydown" : "keyup", { code }),
      );
    engine.apply((s) => debug.setScreen(s, "playing"));
    engine.apply((s) => debug.clearPredators(s));
    // Pre-roll: real sonar floods leave explored ground in memory.
    for (const [x, y] of [
      [9, 11],
      [13, 11],
      [22, 11],
      [22, 5],
      [13, 5],
      [9, 5],
      [5, 5],
    ]) {
      engine.apply((s) => debug.setForagerTile(s, x, y));
      engine.apply((s) => debug.setSonarCooldown(s, 0));
      key("Space");
      await engine.advance(24);
      key("Space", false);
    }
    await engine.advance(60);
    engine.apply((s) => debug.setForagerTile(s, 13, 11));
    engine.apply((s) => debug.addPredator(s, "flarefish", 22, 8));
    engine.apply((s) => debug.setPredatorTravel(s, 0, false));
    await engine.advance(202);
    engine.apply((s) => debug.addPredator(s, "lanternjaw", 9, 13));
    engine.apply((s) => debug.addPredator(s, "gloamfin", 17, 11));
    engine.apply((s) => debug.spawnDrifter(s, 9, 11));
    engine.apply((s) => debug.setBrightness(s, 1));
    engine.apply((s) => debug.setBrightHold(s, 1));
    engine.apply((s) => debug.setScore(s, 1240));
    engine.apply((s) => debug.setSonarCooldown(s, 0));
    engine.startRecording();
    key("ArrowUp");
    key("Space");
    let image = "";
    for (let frame = 0; frame < 180; frame++) {
      if (frame === 1) key("Space", false);
      if (frame === 45) {
        key("ArrowUp", false);
        key("ArrowLeft");
      }
      if (frame === 70) key("Space");
      if (frame === 71) key("Space", false);
      if (frame === 100) key("ShiftLeft");
      if (frame === 101) key("ShiftLeft", false);
      if (frame === 105) {
        key("ArrowLeft", false);
        key("ArrowDown");
      }
      if (frame === 140) key("Space");
      if (frame === 141) key("Space", false);
      if (frame === 165) {
        key("ArrowDown", false);
        key("ArrowRight");
      }
      await engine.advance(1);
      if (frame === 28) image = canvas.toDataURL("image/png");
    }
    const recording = engine.stopRecording();
    const snapshot = debug.snapshot(engine.state);
    engine.destroy();
    return { recording, image, snapshot };
  });
  await writeFile(
    "showcase/dive.json.gz",
    gzipSync(JSON.stringify(capture.recording)),
  );
  await writeFile(
    "showcase/dive.png",
    Buffer.from(capture.image.split(",")[1], "base64"),
  );
  console.log(
    `Captured ${capture.recording.frames.length} frames; final screen: ${capture.snapshot.screen}`,
  );
} finally {
  await browser.close();
}
