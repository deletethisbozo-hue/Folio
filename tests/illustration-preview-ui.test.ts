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
const fixture = path.join(os.tmpdir(), `folio-preview-illustration-${Date.now()}.png`);
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
await fs.writeFile(fixture, pixel);

console.log("\nFolio front matter illustration preview + crop");
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  await page.click('.library-add-section');
  await page.waitForSelector('.folio-dialog[aria-label="Add Content"]');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".content-kind-group button")]
      .find((item) => item.querySelector("span")?.textContent?.trim() === "Preface");
    if (!button) throw new Error("Preface option is missing");
    button.click();
  });
  await page.waitForFunction(() => document.querySelector(".contents-row.selected")?.textContent?.includes("Preface"));
  await page.waitForSelector('.illustration-button:not([disabled])');

  const firstUploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/illustration"), { timeout: 12000 });
  const [firstChooser] = await Promise.all([page.waitForFileChooser({ timeout: 12000 }), page.click(".illustration-button")]);
  await firstChooser.accept([fixture]);
  const firstUpload = await firstUploadResponse;
  if (!firstUpload.ok()) throw new Error("Illustration upload failed: " + firstUpload.status() + " " + (await firstUpload.text()));

  await page.waitForFunction(() => Boolean(document.querySelector(".editor-illustration") || document.querySelector(".global-error")), { timeout: 8000 });
  const earlyUploadState = await page.evaluate(() => ({
    hasFigure: Boolean(document.querySelector(".editor-illustration")),
    error: document.querySelector(".global-error")?.textContent ?? "",
    files: (document.querySelector(".illustration-input") as HTMLInputElement | null)?.files?.length ?? -1,
    disabled: (document.querySelector(".illustration-input") as HTMLInputElement | null)?.disabled ?? null,
  }));
  if (!earlyUploadState.hasFigure) throw new Error("illustration upload state: " + JSON.stringify(earlyUploadState));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const first = await page.evaluate(async () => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
    let status = 0; let body = "";
    if (image?.src) { try { const response = await fetch(image.src); status = response.status; if (!response.ok) body = (await response.text()).slice(0, 240); } catch (error) { body = String(error); } }
    return { ok: Boolean(figure?.querySelector(".editor-illustration-controls") && image?.complete && image.naturalWidth > 0), controls: Boolean(figure?.querySelector(".editor-illustration-controls")), src: image?.src ?? "", complete: image?.complete ?? false, naturalWidth: image?.naturalWidth ?? 0, asset: image?.dataset.folioAsset ?? "", markdown: (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "", status, body, error: document.querySelector(".global-error")?.textContent ?? "" };
  });
  if (!first.ok) throw new Error("illustration preview diagnostic: " + JSON.stringify(first));
  check("illustration gets visible scale/crop controls", true);

  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const image = frame?.contentDocument?.querySelector<HTMLImageElement>(".folio-illustration-preview img, img.folio-illustration");
    return Boolean(image?.complete && image.naturalWidth > 0);
  }, { timeout: 30000 });
  check("new front-matter illustration is visible in live preview", true);

  await page.click(".editor-illustration img[data-folio-asset]");
  await page.waitForSelector(".editor-illustration.folio-image-selected .folio-image-inspector");
  check("V2 selects illustration before exposing crop controls", true);

  await page.$eval<HTMLInputElement>('[data-folio-control="scale"]', (control) => {
    control.value = "60";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click('[data-folio-control="crop"]');
  await page.$eval<HTMLSelectElement>('[data-folio-control="ratio"]', (control) => {
    control.value = "1-1";
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.$eval<HTMLInputElement>('[data-folio-control="x"]', (control) => {
    control.value = "25";
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.$eval<HTMLInputElement>('[data-folio-control="y"]', (control) => {
    control.value = "75";
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const markdown = (document.querySelector(".rich-editor") as HTMLElement | null)?.dataset.markdown ?? "";
    return markdown.includes("width=60%")
      && markdown.includes(".folio-crop")
      && markdown.includes(".folio-ratio-1-1")
      && markdown.includes("data-folio-x=25")
      && markdown.includes("data-folio-y=75");
  });
  check("crop, scale and focal point serialize into manuscript Markdown", true);

  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
    const figure = frame?.contentDocument?.querySelector<HTMLElement>(".folio-illustration-preview");
    const image = figure?.querySelector<HTMLImageElement>("img");
    return Boolean(
      figure &&
      Math.abs(parseFloat(figure.style.width || "0") - 60) < 1 &&
      image?.style.objectFit === "cover" &&
      (image.style.aspectRatio === "1 / 1" || image.style.aspectRatio === "1/1")
    );
  });
  check("live preview applies crop and scale immediately", true);

  await page.waitForFunction(() => document.querySelector(".save-indicator")?.textContent === "Saved");
  await page.click('.tiny-footer-button[aria-label="Reload files"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".contents-row")].some((row) => row.textContent?.includes("Preface")));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>(".contents-row")].find((item) => item.textContent?.includes("Preface"));
    if (!row) throw new Error("Preface row missing after reload");
    row.click();
  });
  await page.waitForFunction(() => {
    const figure = document.querySelector<HTMLElement>(".editor-illustration");
    const scale = figure?.querySelector<HTMLInputElement>('[data-folio-control="scale"]')?.value;
    const ratio = figure?.querySelector<HTMLSelectElement>('[data-folio-control="ratio"]')?.value;
    const image = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]");
    return Boolean(figure?.dataset.folioCrop === "true" && scale === "60" && ratio === "1-1" && image?.naturalWidth);
  });
  check("crop and scale survive autosave plus project reload", true);
} catch (error) {
  failed++;
  console.error("✗ illustration preview/crop scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
