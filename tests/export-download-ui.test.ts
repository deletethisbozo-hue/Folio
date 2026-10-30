import express from "express";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { registerWriteStudioApi } from "../server/write-studio-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nExport download and size-report UI");
const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
registerWriteStudioApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-export-download-ui-"));
const proofDir = path.join(ROOT, "build", "qa-export-download-ui");
await fs.mkdir(proofDir, { recursive: true });

const formats = [
  { label: "EPUB · Kindle", format: "epub", ext: ".epub", filename: /_kdp\.epub$/i, magic: "PK" },
  { label: "EPUB · Universal", format: "epub", ext: ".epub", filename: /^(?!.*_kdp\.epub$).+\.epub$/i, magic: "PK" },
  { label: "Print PDF", format: "print", ext: ".pdf", filename: /^Proof Print\.pdf$/, magic: "%PDF-", customName: "Proof Print" },
  { label: "PDF/X-3 · CMYK", format: "pdfx", ext: ".pdf", filename: /^Proof PDFX\.pdf$/, magic: "%PDF-", customName: "Proof PDFX" },
  { label: "Reading PDF", format: "pdf", ext: ".pdf", filename: /^Proof Reading\.pdf$/, magic: "%PDF-", customName: "Proof Reading" },
  { label: "Word (.docx)", format: "docx", ext: ".docx", filename: /\.docx$/i, magic: "PK" },
];

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.setViewport({ width: 1440, height: 900 });
  const unexpectedApiResponses: string[] = [];
  page.on("response", (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    if (new URL(response.url()).pathname.startsWith("/api/") && contentType.includes("text/html")) {
      unexpectedApiResponses.push(`${response.request().method()} ${response.url()}`);
    }
  });
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
  let holdFirstExport = true;
  let releaseFirstExport: (() => void) | null = null;
  const firstExportGate = new Promise<void>((resolve) => { releaseFirstExport = resolve; });
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (holdFirstExport && request.method() === "POST" && new URL(request.url()).pathname.endsWith("/export")) {
      holdFirstExport = false;
      await firstExportGate;
    }
    await request.continue();
  });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample button missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.click(".generate-button");

  for (const item of formats) {
    const before = new Set(await fs.readdir(downloadDir));
    const responsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== "POST" || !new URL(response.url()).pathname.endsWith("/export")) return false;
      try { return JSON.parse(response.request().postData() ?? "{}").format === item.format; }
      catch { return false; }
    }, { timeout: 60_000 });
    const buttons = await page.$$(".generate-menu button");
    let target: typeof buttons[number] | undefined;
    for (const candidate of buttons) {
      if ((await candidate.evaluate((element) => element.textContent?.trim())) === item.label) { target = candidate; break; }
    }
    if (!target) throw new Error(`Export action missing: ${item.label}`);
    await target.click();
    if ("customName" in item) {
      await page.waitForSelector('[role="dialog"] input');
      check(`${item.label} asks for a file name`, true);
      await page.focus('[role="dialog"] input');
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await page.keyboard.type(item.customName as string);
      await page.keyboard.press("Enter");
    }
    if (item.label === "EPUB · Kindle") {
      await page.waitForSelector(".export-progress", { timeout: 10000 });
      const progress = await page.$eval(".export-progress", (element) => {
        const status = element.getBoundingClientRect();
        const toolbar = element.parentElement?.querySelector<HTMLElement>(".device-toolbar")?.getBoundingClientRect();
        const stage = element.parentElement?.querySelector<HTMLElement>(".preview-stage")?.getBoundingClientRect();
        return {
          top: status.top,
          bottom: status.bottom,
          toolbarBottom: toolbar?.bottom ?? Infinity,
          stageTop: stage?.top ?? -Infinity,
          menuOpen: Boolean(element.parentElement?.querySelector(".generate-menu")),
          text: element.textContent?.trim() ?? "",
        };
      });
      const visibleBelowToolbar = progress.top >= progress.toolbarBottom - 1 &&
        progress.bottom <= progress.stageTop + 1 &&
        !progress.menuOpen;
      check("Export progress stays visible below the format toolbar", visibleBelowToolbar, progress.text);
      await page.screenshot({ path: path.join(proofDir, "export-progress.png"), fullPage: false });
      releaseFirstExport?.();
    }
    const response = await responsePromise;
    const result = await response.json() as {
      filename?: string;
      bytes?: number;
      written?: boolean;
      dataBase64?: string;
      sizeReport?: { fontsBytes?: number };
    };
    const downloadable = response.ok() && !result.written && Boolean(result.dataBase64) && Boolean(result.filename);
    check(`${item.label} export API returns a non-empty artifact`, downloadable && Number(result.bytes) > 0 && item.filename.test(result.filename ?? ""), `${result.filename ?? "no filename"} · ${result.bytes ?? 0} bytes · written=${Boolean(result.written)} · base64=${Boolean(result.dataBase64)}`);
    if (!downloadable) continue;

    const deadline = Date.now() + 25_000;
    let downloaded: string | null = null;
    while (Date.now() < deadline) {
      const files = await fs.readdir(downloadDir);
      const candidate = files.find((name) => !before.has(name) && name.toLowerCase().endsWith(item.ext) && !name.endsWith(".crdownload"));
      if (candidate) {
        const stat = await fs.stat(path.join(downloadDir, candidate));
        if (stat.size > 1000) { downloaded = candidate; break; }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const bytes = downloaded ? await fs.readFile(path.join(downloadDir, downloaded)) : Buffer.alloc(0);
    check(`${item.label} is actually downloaded by the UI`, Boolean(downloaded) && downloaded === result.filename && bytes.length > 1000 && bytes.subarray(0, item.magic.length).toString() === item.magic, downloaded ? `${downloaded} · ${bytes.length} bytes · expected ${result.filename}` : `no completed download appeared · expected ${result.filename}`);

    if (item.label === "EPUB · Kindle") {
      await page.waitForSelector(".export-size-report", { timeout: 10000 });
      const report = await page.$eval(".export-size-report", (element) => {
        const details = element as HTMLDetailsElement;
        const rect = details.getBoundingClientRect();
        const menu = details.closest<HTMLElement>(".generate-menu")?.getBoundingClientRect();
        const pane = details.closest<HTMLElement>(".preview-pane")?.getBoundingClientRect();
        const labels = [...details.querySelectorAll<HTMLElement>(".export-size-grid span")];
        const fontIndex = labels.findIndex((label) => label.textContent?.trim() === "Fonts");
        return {
          open: details.open,
          height: rect.height,
          top: rect.top,
          bottom: rect.bottom,
          viewportHeight: window.innerHeight,
          menuBottom: menu?.bottom ?? 0,
          paneBottom: pane?.bottom ?? 0,
          summary: details.querySelector("summary")?.textContent?.trim() ?? "",
          content: details.textContent ?? "",
          fontsText: fontIndex >= 0 ? labels[fontIndex].nextElementSibling?.textContent?.trim() ?? "" : "",
        };
      });
      check("EPUB breakdown is open and visible after export", report.open && report.height > 30 && report.top < report.viewportHeight && report.bottom <= report.menuBottom && report.menuBottom <= report.paneBottom && /Images/.test(report.content), `${report.height.toFixed(0)} px · ${report.summary}`);
      check("Kindle EPUB reports embedded theme-font bytes", (result.sizeReport?.fontsBytes ?? 0) > 0 && Boolean(report.fontsText) && !/^0(?:\s|$)/.test(report.fontsText), `${report.fontsText || "no font-size row"} · ${result.sizeReport?.fontsBytes ?? 0} bytes`);
      await page.screenshot({ path: path.join(proofDir, "epub-kindle-font-report.png"), fullPage: false });
    }
  }

  check("API requests do not fall through to the HTML app shell", unexpectedApiResponses.length === 0, unexpectedApiResponses.join(", "));
  await page.close();
} catch (error) {
  fail++;
  console.error("✗ Export UI scenario completed");
  console.error(error);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(downloadDir, { recursive: true, force: true });
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
