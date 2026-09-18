import express from "express";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
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
const newBookRoot = await fs.mkdtemp(path.join(os.tmpdir(), "folio-v208-new-book-"));
const newBookFile = path.join(newBookRoot, "Dashboard Test.folio");

console.log("\nFolio 2.0.8 dashboard navigation");
try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width: 1440, height: 900 });

  let nextPickedProjectFile: string | null = null;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (nextPickedProjectFile && request.method() === "POST" && request.url().endsWith("/api/pick-project-file")) {
      const picked = nextPickedProjectFile;
      nextPickedProjectFile = null;
      void request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ path: picked }) });
    } else {
      void request.continue();
    }
  });

  await page.goto(base, { waitUntil: "networkidle0" });
  check("dashboard has no redundant standalone F mark", (await page.$(".start-mark")) === null);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button is missing");
    button.click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');

  check("workspace exposes New Project in the masthead", Boolean(await page.$('[data-command="new-project"]')));
  check("workspace wordmark is a real dashboard control", await page.$eval(".command-wordmark", (node) => node.getAttribute("aria-label") === "Back to dashboard"));

  nextPickedProjectFile = newBookFile;
  await page.click('[data-command="new-project"]');
  await page.waitForSelector('.folio-dialog[aria-label="New Book"]');
  check("New Project opens the existing real New Book dialog", true);
  await page.click('.folio-dialog[aria-label="New Book"] button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector('.folio-dialog[aria-label="New Book"]'));

  await page.click(".command-wordmark");
  await page.waitForSelector(".start-shell");
  check("clicking folio returns from a project to the dashboard", Boolean(await page.$(".start-shell")));
} catch (error) {
  fail++;
  console.error("  ✗ dashboard navigation browser scenario", error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(newBookRoot, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
