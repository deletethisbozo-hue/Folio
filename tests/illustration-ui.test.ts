import express from "express";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log("  " + (ok ? "✓" : "✗") + " " + label + (detail ? " — " + detail : ""));
  ok ? passed++ : failed++;
};

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const fixture = path.join(os.tmpdir(), `folio-inline-illustration-${Date.now()}.png`);
await fs.writeFile(fixture, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

console.log("\nFolio front matter illustration UI");
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  await page.click('[data-command="add"]');
  await page.waitForSelector('.folio-dialog[aria-label="Add Content"]');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".content-kind-group button")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Preface");
    if (!button) throw new Error("Preface front-matter option is missing");
    button.click();
  });
  await page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Preface"));
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  check("editable front matter can be created from Add Content", true);

  const enabled = await page.$eval(".illustration-button", (button) => !(button as HTMLButtonElement).disabled);
  check("front matter exposes an enabled Image control", enabled);

  const input = await page.$(".illustration-input");
  if (!input) throw new Error("Illustration file input is missing");
  await input.uploadFile(fixture);
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    const markdown = (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "";
    return Boolean(image?.complete && image.naturalWidth > 0 && image.dataset.folioAsset?.startsWith("assets/") && markdown.includes("{.folio-illustration}"));
  });
  check("choosing a PNG inserts a visible illustration and semantic Markdown", true);

  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved", { timeout: 30000 });
  const beforeReload = await page.$eval(".rich-editor", (editor) => (editor as HTMLElement).dataset.markdown ?? "");
  check("inline illustration reaches autosave", /!\[[^\]]+\]\(assets\/[a-z0-9._-]+\.png\)\{\.folio-illustration\}/i.test(beforeReload), beforeReload);

  await page.click('.tiny-footer-button[aria-label="Reload files"]');
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".editor-illustration img[data-folio-asset]");
    const markdown = (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "";
    return Boolean(image?.complete && image.naturalWidth > 0 && markdown.includes("{.folio-illustration}"));
  }, { timeout: 30000 });
  check("saved front-matter illustration survives a real project reload", true);

  await page.click(".editor-illustration-remove");
  await page.waitForFunction(() => !document.querySelector(".editor-illustration") && !(document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown?.includes("{.folio-illustration}"));
  check("front-matter illustration can be removed from the editor", true);
} catch (error) {
  failed++;
  console.error("✗ browser illustration scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
