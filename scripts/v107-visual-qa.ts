import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const qa = path.join(ROOT, "build", "qa-v107");
await fs.mkdir(qa, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const polish = [
  "Poczucie bezsensowności było o wiele większym brzemieniem niż brak zasobów. Porażka — nic więcej jak przygnębiająca. Z jego perspektywy życie nie było wyborem, tylko konsekwencją wszystkich przemilczanych decyzji.",
  "Niektórzy w mieście chcieli jego śmierci za rzeczy, których nigdy nie uczynił. W Polsce i na świecie profesjonalny skład książki powinien zachowywać równy rytm, rozsądne dzielenie wyrazów oraz spokojną szarość typograficzną bez rzek bieli.",
  "— Czy naprawdę możemy tam wrócić? — zapytała. — Możemy, ale nie powinniśmy udawać, że niczego się nie boimy. Najtrudniejsze odpowiedzi przychodzą przecież dopiero wtedy, gdy kończą się wszystkie łatwe pytania.",
];
const english = [
  "There are moments in every life that arrive quietly, without warning, and yet change everything. I did not know that morning, as the light moved through the window and across the table, that I was standing at the threshold of a larger story.",
  "Looking back, I can see how the ordinary contained the extraordinary all along—how every small choice, every overlooked detail, was leading me here. Professional typesetting should feel calm, even, and almost invisible to the reader.",
];

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample is missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.body));
  await page.waitForSelector(".preview-loading", { hidden: true });

  const dimensions = await page.evaluate(() => {
    const shell = document.querySelector(".folio-shell")!.getBoundingClientRect();
    const editor = document.querySelector(".editor-pane")!.getBoundingClientRect();
    const preview = document.querySelector(".preview-pane")!.getBoundingClientRect();
    const stage = document.querySelector(".preview-stage")!;
    return {
      shellWidth: shell.width,
      editorWidth: editor.width,
      previewWidth: preview.width,
      previewBackground: getComputedStyle(stage).backgroundColor,
    };
  });
  if (dimensions.previewWidth < 390 || dimensions.editorWidth < 620 || dimensions.previewBackground === "rgb(36, 37, 40)") {
    throw new Error(`Unprofessional studio geometry: ${JSON.stringify(dimensions)}`);
  }
  await page.screenshot({ path: path.join(qa, "studio-ivory.png") });
  await page.click(".tone-toggle");
  await page.waitForFunction(() => document.querySelector(".folio-shell")?.getAttribute("data-ui-tone") === "midnight");
  await page.waitForSelector(".preview-loading", { hidden: true });
  await page.screenshot({ path: path.join(qa, "studio-midnight.png") });
  await page.click(".tone-toggle");

  const replaceEditor = async (paragraphs: string[]) => {
    await page.$eval(".rich-editor", (element, values) => {
      const editor = element as HTMLElement;
      const ornament = '<div class="editor-scene-break" data-scene-break="true" contenteditable="false"><span>⁂</span><button type="button" class="editor-scene-break-remove">×</button></div>';
      editor.innerHTML = values.map((value) => `<p>${value}</p>`).join(ornament);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    }, paragraphs);
    const needle = paragraphs[0].slice(0, 48);
    await page.waitForFunction((value) => (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown?.includes(value), {}, needle);
    await page.waitForFunction((value) => {
      const doc = document.querySelector("iframe")?.contentDocument;
      const first = doc?.querySelector<HTMLElement>("section.chapter > p.folio-composed");
      return Boolean(first?.textContent?.replace(/\u00ad/g, "").includes(value)
        && first.querySelector(".folio-composed-line"));
    }, {}, needle);
    await page.waitForSelector(".preview-loading", { hidden: true });
    // Let the async compositor finish its viewport batch and prove that the
    // visible frame, rather than a stale hidden string, contains this corpus.
    await new Promise((resolve) => setTimeout(resolve, 250));
  };

  const setLanguage = async (language: string) => {
    await page.click('[data-command="book"]');
    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]');
    await page.evaluate((value) => {
      const row = [...document.querySelectorAll(".dialog-field")].find((node) => node.querySelector("span")?.textContent === "Language");
      const input = row?.querySelector("input") as HTMLInputElement | null;
      if (!input) throw new Error("Language field is missing");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, language);
    await page.evaluate(() => {
      const button = [...document.querySelectorAll(".folio-dialog footer button")].find((node) => node.textContent === "Save");
      (button as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]', { hidden: true });
    await page.waitForFunction((value) => [...document.querySelectorAll(".folio-statusbar span")].some((node) => node.textContent === value), {}, language);
    // Saving metadata reloads the selected section. Let that authoritative
    // read settle before replacing the manuscript with the visual corpus.
    await new Promise((resolve) => setTimeout(resolve, 800));
    await page.waitForSelector('.rich-editor[contenteditable="true"]');
    await page.waitForFunction(() => Boolean((document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown));
  };

  const setDropcap = async (enabled: boolean) => {
    await page.click('[data-command="design"]');
    await page.waitForSelector(".style-category-list");
    await page.evaluate(() => {
      const button = [...document.querySelectorAll(".style-category-list button")].find((node) => node.textContent === "First Paragraph");
      (button as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForSelector('.customize-row input[type="checkbox"]');
    const checked = await page.$eval('.customize-row input[type="checkbox"]', (node) => (node as HTMLInputElement).checked);
    if (checked !== enabled) await page.click('.customize-row input[type="checkbox"]');
    await page.click(".style-library-header button");
    await page.waitForFunction((want) => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector(".dropcap")) === want, {}, enabled);
    await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p.folio-composed")));
  };

  const metrics = async (label: string) => {
    const report = await page.evaluate(() => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const paragraphs = [...doc.querySelectorAll<HTMLElement>("section.chapter > p.folio-composed")];
      let justifiedLines = 0;
      let hyphenatedLines = 0;
      let maxHyphenStreak = 0;
      let maxRightErrorPx = 0;
      let maxWordSpacingEm = 0;
      let maxTrackingEm = 0;
      let maxSemanticGapEm = 0;
      let maxAdjacentSpacingDeltaEm = 0;
      let emergencyLines = 0;
      const emergencyDetails: Array<{ text: string; wordSpacingEm: number; trackingEm: number }> = [];
      let ornamentalBreaksOffCenter = 0;
      for (const paragraph of paragraphs) {
        const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
        let streak = 0;
        let previousSpacing: number | null = null;
        for (const line of lines) {
          const fontSize = Number.parseFloat(getComputedStyle(line).fontSize) || 16;
          const justified = line.classList.contains("folio-line-justified");
          if (justified) {
            justifiedLines++;
            const range = doc.createRange();
            range.selectNodeContents(line);
            maxRightErrorPx = Math.max(maxRightErrorPx, Math.abs(line.getBoundingClientRect().right - range.getBoundingClientRect().right));
            const spacing = Number(line.dataset.folioWordSpacing ?? 0) / fontSize;
            maxWordSpacingEm = Math.max(maxWordSpacingEm, Math.abs(spacing));
            maxTrackingEm = Math.max(maxTrackingEm, Math.abs(Number(line.dataset.folioTracking ?? 0) / fontSize));
            if (previousSpacing !== null) maxAdjacentSpacingDeltaEm = Math.max(maxAdjacentSpacingDeltaEm, Math.abs(spacing - previousSpacing));
            previousSpacing = spacing;
            const words = [...line.querySelectorAll<HTMLElement>(".folio-word")];
            for (let index = 1; index < words.length; index++) {
              if (words[index].dataset.folioSpaceBefore === "true") {
                maxSemanticGapEm = Math.max(maxSemanticGapEm, (words[index].getBoundingClientRect().left - words[index - 1].getBoundingClientRect().right) / fontSize);
              }
            }
          }
          if (line.textContent?.endsWith("-")) {
            hyphenatedLines++;
            streak++;
            maxHyphenStreak = Math.max(maxHyphenStreak, streak);
          } else streak = 0;
          if (line.dataset.folioEmergency === "true") {
            emergencyLines++;
            emergencyDetails.push({
              text: line.textContent?.replace(/\u00ad/g, "") ?? "",
              wordSpacingEm: Number(line.dataset.folioWordSpacing ?? 0) / fontSize,
              trackingEm: Number(line.dataset.folioTracking ?? 0) / fontSize,
            });
          }
        }
      }
      for (const ornament of doc.querySelectorAll<HTMLElement>(".scene-break")) {
        const parent = ornament.parentElement?.getBoundingClientRect();
        const rect = ornament.getBoundingClientRect();
        if (parent && Math.abs((rect.left + rect.right - parent.left - parent.right) / 2) > 1.5) ornamentalBreaksOffCenter++;
      }
      return {
        paragraphCount: paragraphs.length,
        justifiedLines,
        hyphenatedLines,
        hyphenRate: hyphenatedLines / Math.max(1, justifiedLines),
        maxHyphenStreak,
        maxRightErrorPx,
        maxWordSpacingEm,
        maxTrackingEm,
        maxSemanticGapEm,
        maxAdjacentSpacingDeltaEm,
        emergencyLines,
        emergencyDetails,
        ornamentalBreaksOffCenter,
      };
    });
    await fs.writeFile(path.join(qa, `${label}.json`), JSON.stringify(report, null, 2) + "\n", "utf8");
    if (
      report.paragraphCount < 2 || report.justifiedLines < 6 || report.maxRightErrorPx > 1.75 ||
      report.maxWordSpacingEm > 0.116 || report.maxTrackingEm > 0.0057 || report.maxSemanticGapEm > 0.43 ||
      report.maxAdjacentSpacingDeltaEm > 0.22 || report.hyphenRate > 0.45 || report.maxHyphenStreak > 2 ||
      report.emergencyLines !== 0 || report.ornamentalBreaksOffCenter !== 0
    ) throw new Error(`${label} failed typographic QA: ${JSON.stringify(report)}`);
    return report;
  };

  await setLanguage("pl");
  await setDropcap(false);
  await replaceEditor(polish);
  const screen = await page.$(".reader-screen");
  if (!screen) throw new Error("Reader screen is missing");
  await screen.screenshot({ path: path.join(qa, "reader-polish.png") });
  const polishReport = await metrics("typesetting-polish");

  await setDropcap(true);
  await screen.screenshot({ path: path.join(qa, "reader-polish-dropcap.png") });
  const dropcapReport = await metrics("typesetting-polish-dropcap");

  await setLanguage("en");
  await setDropcap(false);
  await replaceEditor(english);
  await screen.screenshot({ path: path.join(qa, "reader-english.png") });
  const englishReport = await metrics("typesetting-english");

  console.log(JSON.stringify({ dimensions, polishReport, dropcapReport, englishReport }, null, 2));
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
