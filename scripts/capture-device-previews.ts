import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";
import { previewProfiles } from "../web/src/device-profiles.ts";

async function clickButtonByText(page: any, selector: string, text: string) {
  const clicked = await page.evaluate(({ selector, text }: { selector: string; text: string }) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(selector)]
      .find((item) => item.textContent?.trim() === text);
    if (!button) return false;
    button.click();
    return true;
  }, { selector, text });
  if (!clicked) throw new Error("Button not found: " + text);
}

const app = express();
app.use(express.json({ limit: "20mb" }));
registerApi(app);
registerEditorApi(app);
registerWriteStudioApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const outDir = path.join(ROOT, "artifacts", "device-previews");

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1468, height: 739, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await clickButtonByText(page, "button", "Open Sample");
  await page.waitForSelector(".folio-shell");
  await page.waitForSelector(".manuscript-editor");
  await fs.mkdir(outDir, { recursive: true });

  const results: any[] = [];
  for (const profile of previewProfiles.filter((item) => item.family !== "print")) {
    await page.select('select[aria-label="Preview device"]', profile.value);
    await page.waitForFunction((mode: string) => {
      const el = document.querySelector(".reader-device");
      return Boolean(el?.classList.contains("device-" + mode));
    }, {}, profile.value);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const measurement = await page.evaluate(({ mode, expectedAspect }: { mode: string; expectedAspect: number }) => {
      const shell = document.querySelector<HTMLElement>(".reader-device.device-" + mode);
      const screen = shell?.querySelector<HTMLElement>(".reader-screen");
      const stage = document.querySelector<HTMLElement>(".preview-stage.device-stage");
      if (!shell || !screen || !stage) throw new Error("Missing shell, screen or stage for " + mode);
      const s = shell.getBoundingClientRect();
      const r = screen.getBoundingClientRect();
      const p = stage.getBoundingClientRect();
      const shellStyle = getComputedStyle(shell);
      const before = getComputedStyle(shell, "::before");
      const after = getComputedStyle(shell, "::after");
      return {
        mode,
        shellWidth: s.width,
        shellHeight: s.height,
        screenWidth: r.width,
        screenHeight: r.height,
        stageWidth: p.width,
        stageHeight: p.height,
        fitsStage: s.width <= p.width - 2 && s.height <= p.height - 2,
        screenAspect: r.width / r.height,
        expectedAspect,
        radius: shellStyle.borderRadius,
        beforeContent: before.content,
        afterContent: after.content,
      };
    }, {
      mode: profile.value,
      expectedAspect: profile.viewport.width / profile.viewport.height,
    });

    if (!measurement.fitsStage) {
      throw new Error(
        profile.value + " shell does not fit the preview stage: " +
        measurement.shellWidth.toFixed(1) + "x" + measurement.shellHeight.toFixed(1) +
        " in " + measurement.stageWidth.toFixed(1) + "x" + measurement.stageHeight.toFixed(1)
      );
    }

    if (Math.abs(measurement.screenAspect - measurement.expectedAspect) > 0.012) {
      throw new Error(
        profile.value + " screen aspect drifted: " +
        measurement.screenAspect.toFixed(4) + " vs " + measurement.expectedAspect.toFixed(4)
      );
    }

    if (profile.family === "phone" && parseFloat(measurement.radius) < 30) {
      throw new Error(profile.value + " no longer reads as a phone shell.");
    }
    if (profile.family === "tablet" && parseFloat(measurement.radius) < 15) {
      throw new Error(profile.value + " no longer reads as a tablet shell.");
    }
    if ((profile.value === "kobo-7" || profile.value === "kobo-8") &&
        measurement.shellWidth / measurement.screenWidth < 1.18) {
      throw new Error(profile.value + " lost its asymmetric side-grip silhouette.");
    }

    results.push(measurement);
    await page.screenshot({
      path: path.join(outDir, profile.value + ".png"),
      fullPage: false,
    });
  }

  const widths = Object.fromEntries(results.map((item) => [item.mode, Math.round(item.shellWidth)]));
  if (new Set(Object.values(widths)).size < 6) {
    throw new Error("Device shells collapsed back toward universal sizing: " + JSON.stringify(widths));
  }
  await fs.writeFile(path.join(outDir, "measurements.json"), JSON.stringify(results, null, 2));

  // Footer regression: reproduce the real Write + Split state where the collision was reported.
  await clickButtonByText(page, "button", "Write");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-workspace-mode") === "write");
  const splitToggle = await page.$('button[aria-label="Split editor"]');
  if (splitToggle) {
    await splitToggle.click();
    await page.waitForSelector(".writing-split-pane");
  }

  // Every visible status child must have its own horizontal lane.
  const footer = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".folio-statusbar");
    if (!bar) throw new Error("Status bar missing.");
    const rects = [...bar.children].map((node) => {
      const r = (node as HTMLElement).getBoundingClientRect();
      return { text: (node.textContent ?? "").trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }).filter((item) => item.right > item.left);
    const collisions: string[] = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) collisions.push(a.text + " <> " + b.text);
      }
    }
    return { rects, collisions };
  });
  if (footer.collisions.length) throw new Error("Status bar overlap: " + footer.collisions.join("; "));
  await fs.writeFile(path.join(outDir, "write-statusbar.json"), JSON.stringify(footer, null, 2));
  await page.screenshot({ path: path.join(outDir, "write-statusbar.png"), fullPage: false });

  // Design modal must be a centred light surface, not the old dark inset frame.
  await clickButtonByText(page, "button", "Design");
  await page.waitForSelector(".style-library");
  const modal = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>(".style-overlay");
    const library = document.querySelector<HTMLElement>(".style-library");
    if (!overlay || !library) throw new Error("Design modal missing.");
    const o = getComputedStyle(overlay);
    const l = getComputedStyle(library);
    return {
      overlayBackground: o.backgroundColor,
      overlayLeft: overlay.getBoundingClientRect().left,
      overlayRight: overlay.getBoundingClientRect().right,
      libraryRadius: l.borderRadius,
      libraryBackground: l.backgroundColor,
      libraryWidth: library.getBoundingClientRect().width,
    };
  });
  if (modal.overlayLeft > 2 || modal.overlayRight < 1466) throw new Error("Design overlay is still inset into one pane.");
  if (parseFloat(modal.libraryRadius) < 10) throw new Error("Design surface lost polished radius.");
  if (modal.libraryWidth < 760) throw new Error("Design library is unexpectedly narrow.");
  await page.screenshot({ path: path.join(outDir, "design-library.png"), fullPage: false });

  await clickButtonByText(page, ".style-category-list button", "Chapter Heading");
  await page.waitForSelector(".customize-reset-button");
  const reset = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(".customize-reset-button");
    if (!button) throw new Error("Theme reset button missing.");
    const style = getComputedStyle(button);
    return { radius: style.borderRadius, background: style.backgroundColor, color: style.color, height: button.getBoundingClientRect().height };
  });
  if (parseFloat(reset.radius) < 6 || reset.height < 28) throw new Error("Theme reset control fell back to browser-default styling.");
  await page.screenshot({ path: path.join(outDir, "design-chapter-heading.png"), fullPage: false });

  console.log(JSON.stringify({ devices: results, footer, modal, reset }, null, 2));
} finally {
  server.close();
  await closeBrowser();
}
