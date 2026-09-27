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
      if (!shell || !screen) throw new Error("Missing shell or screen for " + mode);
      const s = shell.getBoundingClientRect();
      const r = screen.getBoundingClientRect();
      const shellStyle = getComputedStyle(shell);
      const before = getComputedStyle(shell, "::before");
      const after = getComputedStyle(shell, "::after");
      return {
        mode,
        shellWidth: s.width,
        shellHeight: s.height,
        screenWidth: r.width,
        screenHeight: r.height,
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

  await fs.writeFile(path.join(outDir, "measurements.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  server.close();
  await closeBrowser();
}
