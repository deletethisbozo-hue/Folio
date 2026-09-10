import express from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v106");
await fs.mkdir(qa, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample is missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.body));

  await page.screenshot({ path: path.join(qa, "folio-ivory-studio.png"), fullPage: false });
  await page.click(".tone-toggle");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "midnight");
  await page.screenshot({ path: path.join(qa, "folio-midnight-studio.png"), fullPage: false });

  // Feed representative Polish prose into the existing editor so the screenshot
  // and geometry report exercise the actual app path rather than a synthetic HTML
  // toy that happens to make the compositor look good.
  await page.$eval(".rich-editor", (el) => {
    const editor = el as HTMLElement;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const paragraph = "W chłodnym świetle poranka redaktor zauważył, że profesjonalne formatowanie książki wymaga spokojnego rytmu, rozsądnego dzielenia wyrazów i równych odstępów, ponieważ czytelnik natychmiast widzi każdą przypadkową rzekę bieli pomiędzy słowami.";
    const html = `<p>${paragraph}</p><p>${paragraph} ${paragraph}</p><p>${paragraph}</p>`;
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.waitForFunction(() => {
    const doc = document.querySelector("iframe")?.contentDocument;
    return Boolean(doc?.querySelector("section.chapter > p.folio-composed .folio-line-justified"));
  }, { timeout: 30000 });

  const reader = await page.$(".reader-screen");
  if (!reader) throw new Error("Reader screen is missing");
  await reader.screenshot({ path: path.join(qa, "folio-typesetting-pl.png") });

  const geometry = await page.evaluate(() => {
    const doc = document.querySelector("iframe")!.contentDocument!;
    const paragraph = doc.querySelector<HTMLElement>("section.chapter > p.folio-composed")!;
    const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
    const justified = lines.slice(0, -1).filter((line) => line.classList.contains("folio-line-justified"));
    const rightErrors = justified.map((line) => {
      const lineRect = line.getBoundingClientRect();
      const range = doc.createRange();
      range.selectNodeContents(line);
      return Math.abs(lineRect.right - range.getBoundingClientRect().right);
    });
    const gaps: number[] = [];
    for (const line of justified) {
      const words = [...line.querySelectorAll<HTMLElement>(".folio-word")];
      for (let i = 1; i < words.length; i++) {
        if (words[i].dataset.folioSpaceBefore === "true") {
          gaps.push(words[i].getBoundingClientRect().left - words[i - 1].getBoundingClientRect().right);
        }
      }
    }
    const cap = paragraph.querySelector<HTMLElement>(":scope > .dropcap.folio-composed-cap");
    const first = lines[0]?.getBoundingClientRect();
    const capRect = cap?.getBoundingClientRect();
    return {
      lineCount: lines.length,
      justifiedCount: justified.length,
      maxRightErrorPx: Math.max(...rightErrors, 0),
      maxSemanticGapPx: Math.max(...gaps, 0),
      maxWordSpacingPx: Math.max(...justified.map((line) => Math.abs(Number(line.dataset.folioWordSpacing ?? 0))), 0),
      maxTrackingPx: Math.max(...justified.map((line) => Math.abs(Number(line.dataset.folioTracking ?? 0))), 0),
      finalLineNatural: lines.at(-1)?.classList.contains("folio-line-natural") ?? false,
      dropcapClearancePx: capRect && first ? first.left - capRect.right : null,
    };
  });
  await fs.writeFile(path.join(qa, "typesetting-geometry.json"), JSON.stringify(geometry, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(geometry));
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
