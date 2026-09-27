import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

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

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1468, height: 739, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await clickButtonByText(page, "button", "Open Sample");
  await page.waitForSelector(".folio-shell");
  await page.waitForSelector(".manuscript-editor");

  const visual = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".folio-commandbar");
    const selected = document.querySelector<HTMLElement>(".contents-row.selected");
    const shell = document.querySelector<HTMLElement>(".folio-shell");
    if (!bar || !selected || !shell) throw new Error("Folio chrome missing");
    const barStyle = getComputedStyle(bar);
    const selectedStyle = getComputedStyle(selected);
    const shellStyle = getComputedStyle(shell);
    return {
      backgroundImage: barStyle.backgroundImage,
      selectedBackground: selectedStyle.backgroundColor,
      accent: shellStyle.getPropertyValue("--mockup-accent").trim(),
    };
  });

  if (!visual.backgroundImage.includes("linear-gradient")) throw new Error("Brand masthead gradient is not active.");
  if (visual.accent.toLowerCase() !== "#5b5ce2") throw new Error("Canonical Folio accent changed unexpectedly: " + visual.accent);

  await fs.mkdir(path.join(ROOT, "artifacts"), { recursive: true });
  await page.screenshot({
    path: path.join(ROOT, "artifacts", "folio-brand-preview.png"),
    fullPage: false,
  });
  console.log(JSON.stringify(visual));
} finally {
  server.close();
  await closeBrowser();
}
