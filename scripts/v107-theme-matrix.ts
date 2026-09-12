import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";
import { themeList } from "../server/pipeline/themes.ts";

const qa = path.join(ROOT, "build", "qa-v107");
await fs.mkdir(qa, { recursive: true });

const polish = [
  "Poczucie bezsensowności było o wiele większym brzemieniem niż brak zasobów. Porażka — nic więcej jak przygnębiająca. Z jego perspektywy życie nie było wyborem, tylko konsekwencją wszystkich przemilczanych decyzji.",
  "Niektórzy w mieście chcieli jego śmierci za rzeczy, których nigdy nie uczynił. W Polsce i na świecie profesjonalny skład książki powinien zachowywać równy rytm, rozsądne dzielenie wyrazów oraz spokojną szarość typograficzną bez rzek bieli.",
  "— Czy naprawdę możemy tam wrócić? — zapytała. — Możemy, ale nie powinniśmy udawać, że niczego się nie boimy. Najtrudniejsze odpowiedzi przychodzą przecież dopiero wtedy, gdy kończą się wszystkie łatwe pytania.",
];
const english = [
  "There are moments in every life that arrive quietly, without warning, and yet change everything. I did not know that morning, as the light moved through the window and across the table, that I was standing at the threshold of a larger story.",
  "Looking back, I can see how the ordinary contained the extraordinary all along—how every small choice, every overlooked detail, was leading me here. Professional typesetting should feel calm, even, and almost invisible to the reader.",
  "A careful book designer protects the reader from stranded articles, ugly spacing, excessive hyphenation, and accidental one-word final lines while preserving the character of the chosen style.",
];

const app = express();
app.use(express.json({ limit: "5mb" }));
registerApi(app);
registerEditorApi(app);
app.use(express.static(path.join(ROOT, "web", "dist")));
app.get("*", (_request, response) => response.sendFile(path.join(ROOT, "web", "dist", "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type MatrixResult = {
  theme: string;
  label: string;
  scenario: "pl" | "pl-dropcap" | "en";
  pass: boolean;
  failures: string[];
  metrics: Record<string, unknown>;
};

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
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

  await page.evaluate(() => {
    (window as Window & { __folioThemeQaParagraphText?: (paragraph: HTMLElement) => string }).__folioThemeQaParagraphText = (paragraph) => {
      const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
      if (!lines.length) return (paragraph.textContent ?? "").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
      const cap = (paragraph.querySelector<HTMLElement>(":scope > .dropcap")?.textContent ?? "").replace(/\s+/g, "").trim();
      const text = lines.map((line, index) => {
        let value = (line.textContent ?? "").replace(/\u00ad/g, "");
        const nextWord = lines[index + 1]?.querySelector<HTMLElement>(".folio-word");
        if (nextWord?.dataset.folioHyphenBefore === "true" && value.endsWith("-")) value = value.slice(0, -1);
        else if (index < lines.length - 1) value += " ";
        return value;
      }).join("");
      return `${cap}${text}`.replace(/\s+/g, " ").trim();
    };
  });

  const settlePreview = async () => {
    await page.waitForSelector(".preview-loading", { hidden: true });
    await page.waitForFunction(() => Boolean(document.querySelector("iframe")?.contentDocument?.querySelector("section.chapter > p.folio-composed .folio-composed-line")));
    await sleep(300);
  };

  const replaceEditor = async (paragraphs: string[]): Promise<string> => {
    await page.$eval(".rich-editor", (element, values) => {
      const editor = element as HTMLElement;
      const ornament = '<div class="editor-scene-break" data-scene-break="true" contenteditable="false"><span>⁂</span><button type="button" class="editor-scene-break-remove">×</button></div>';
      editor.innerHTML = values.map((value) => `<p>${value}</p>`).join(ornament);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    }, paragraphs);
    const needle = paragraphs[0].slice(0, 48);
    await page.waitForFunction((value) => (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown?.includes(value), {}, needle);
    await settlePreview();
    await page.waitForFunction((value) => {
      const helper = (window as Window & { __folioThemeQaParagraphText?: (paragraph: HTMLElement) => string }).__folioThemeQaParagraphText;
      const doc = document.querySelector("iframe")?.contentDocument;
      return Boolean(helper && [...(doc?.querySelectorAll<HTMLElement>("section.chapter > p.folio-composed") ?? [])]
        .some((paragraph) => helper(paragraph).includes(value)));
    }, {}, needle);
    return needle;
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
      const save = [...document.querySelectorAll(".folio-dialog footer button")].find((node) => node.textContent === "Save");
      (save as HTMLButtonElement | undefined)?.click();
    }, language);
    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]', { hidden: true });
    await page.waitForFunction((value) => [...document.querySelectorAll(".folio-statusbar span")].some((node) => node.textContent === value), {}, language);
    await settlePreview();
  };

  const setTheme = async (theme: string) => {
    await page.click('[data-command="design"]');
    await page.waitForSelector('.style-library[aria-label="Book style library"]');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll(".style-category-list button")].find((node) => node.textContent === "Book Style");
      if (!button) throw new Error("Book Style category is missing");
      (button as HTMLButtonElement).click();
    });
    await page.waitForSelector(`[data-theme="${theme}"]`);
    await page.click(`[data-theme="${theme}"]`);
    await page.waitForFunction((value) => document.querySelector(`[data-theme="${value}"]`)?.classList.contains("selected"), {}, theme);
    await page.click(".style-library-header button");
    await page.waitForSelector('.style-library[aria-label="Book style library"]', { hidden: true });
    await settlePreview();
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
    await page.waitForSelector('.style-library[aria-label="Book style library"]', { hidden: true });
    await settlePreview();
  };

  const measure = async (theme: string, label: string, scenario: MatrixResult["scenario"], needle: string, expectDropcap: boolean): Promise<MatrixResult> => {
    const report = await page.evaluate(({ expected, englishScenario }) => {
      const helper = (window as Window & { __folioThemeQaParagraphText?: (paragraph: HTMLElement) => string }).__folioThemeQaParagraphText;
      const doc = document.querySelector("iframe")!.contentDocument!;
      const corpusParagraph = [...doc.querySelectorAll<HTMLElement>("section.chapter > p.folio-composed")]
        .find((paragraph) => helper?.(paragraph).includes(expected));
      const section = corpusParagraph?.closest("section");
      const paragraphs = [...(section?.querySelectorAll<HTMLElement>(":scope > p.folio-composed") ?? [])];
      let justifiedLines = 0;
      let hyphenatedLines = 0;
      let maxHyphenStreak = 0;
      let maxRightErrorPx = 0;
      let maxRightProtrusionPx = 0;
      let maxWordSpacingEm = 0;
      let maxStrictWordSpacingEm = 0;
      let maxRelaxedWordSpacingEm = 0;
      let relaxedLines = 0;
      let maxTrackingEm = 0;
      let maxGlyphScaleDelta = 0;
      let maxAdjacentGlyphScaleDelta = 0;
      let maxSemanticGapEm = 0;
      let maxAdjacentSpacingDeltaEm = 0;
      let emergencyLines = 0;
      let oneWordFinalLines = 0;
      const compositionFailureDetails: Array<{ paragraphIndex: number; failure: unknown }> = [];
      const emergencyDetails: Array<{ paragraphIndex: number; lineIndex: number; text: string; previousText: string | null; nextText: string | null; wordSpacingEm: number; trackingEm: number; glyphScale: number; strictFailure: unknown }> = [];
      let strandedEnglishArticleLine = "";

      for (const paragraph of paragraphs) {
        const paragraphIndex = paragraphs.indexOf(paragraph);
        const rawFailure = paragraph.dataset.folioStrictFailure;
        let parsedFailure: unknown = null;
        if (rawFailure) {
          parsedFailure = rawFailure;
          try { parsedFailure = JSON.parse(rawFailure); } catch { /* keep raw diagnostic */ }
          compositionFailureDetails.push({ paragraphIndex, failure: parsedFailure });
        }
        const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
        const finalLine = lines.at(-1);
        if (finalLine && lines.length > 1) {
          const words = [...finalLine.querySelectorAll<HTMLElement>(".folio-word")];
          const semanticWords = words.filter((word, index) => index === 0 || word.dataset.folioSpaceBefore === "true").length;
          if (semanticWords === 1) oneWordFinalLines++;
        }
        let streak = 0;
        // Continuity is meaningful only within one paragraph. The compositor
        // intentionally resets microtype continuity after the natural final line.
        let previousSpacing: number | null = null;
        let previousGlyphScale: number | null = null;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          const style = getComputedStyle(line);
          const fontSize = Number.parseFloat(style.fontSize) || 16;
          const justified = line.classList.contains("folio-line-justified");
          const compressedFinal = line.classList.contains("folio-line-final-compressed");
          const relaxed = line.dataset.folioRelaxed === "true";
          const spacing = Number(line.dataset.folioWordSpacing ?? 0) / fontSize;
          const tracking = Number(line.dataset.folioTracking ?? 0) / fontSize;
          const glyphScale = Number(line.dataset.folioGlyphScale ?? 1);
          const protrusion = Number(line.dataset.folioRightProtrusion ?? 0);
          maxRightProtrusionPx = Math.max(maxRightProtrusionPx, protrusion);
          if (justified) justifiedLines++;
          if (justified || compressedFinal) {
            const range = doc.createRange();
            range.selectNodeContents(line);
            maxRightErrorPx = Math.max(maxRightErrorPx, Math.abs(line.getBoundingClientRect().right + protrusion - range.getBoundingClientRect().right));
            maxWordSpacingEm = Math.max(maxWordSpacingEm, Math.abs(spacing));
            if (relaxed) {
              relaxedLines++;
              maxRelaxedWordSpacingEm = Math.max(maxRelaxedWordSpacingEm, Math.abs(spacing));
            } else maxStrictWordSpacingEm = Math.max(maxStrictWordSpacingEm, Math.abs(spacing));
            maxTrackingEm = Math.max(maxTrackingEm, Math.abs(tracking));
            maxGlyphScaleDelta = Math.max(maxGlyphScaleDelta, Math.abs(glyphScale - 1));
            if (previousGlyphScale !== null) maxAdjacentGlyphScaleDelta = Math.max(maxAdjacentGlyphScaleDelta, Math.abs(glyphScale - previousGlyphScale));
            if (previousSpacing !== null) maxAdjacentSpacingDeltaEm = Math.max(maxAdjacentSpacingDeltaEm, Math.abs(spacing - previousSpacing));
            previousGlyphScale = glyphScale;
            previousSpacing = spacing;
            const words = [...line.querySelectorAll<HTMLElement>(".folio-word")];
            for (let i = 1; i < words.length; i++) {
              if (words[i].dataset.folioSpaceBefore === "true") {
                maxSemanticGapEm = Math.max(maxSemanticGapEm, (words[i].getBoundingClientRect().left - words[i - 1].getBoundingClientRect().right) / fontSize);
              }
            }
          }
          const text = (line.textContent ?? "").replace(/\u00ad/g, "").trim();
          if (text.endsWith("-")) {
            hyphenatedLines++;
            streak++;
            maxHyphenStreak = Math.max(maxHyphenStreak, streak);
          } else streak = 0;
          if (line.dataset.folioEmergency === "true") {
            emergencyLines++;
            emergencyDetails.push({
              paragraphIndex,
              lineIndex,
              text,
              previousText: lines[lineIndex - 1]?.textContent?.replace(/\u00ad/g, "").trim() ?? null,
              nextText: lines[lineIndex + 1]?.textContent?.replace(/\u00ad/g, "").trim() ?? null,
              wordSpacingEm: spacing,
              trackingEm: tracking,
              glyphScale,
              strictFailure: parsedFailure,
            });
          }
          if (englishScenario && lineIndex < lines.length - 1 && /(?:^|\s)(?:a|an|the)$/i.test(text)) strandedEnglishArticleLine ||= text;
        }
      }

      let ornamentalBreaksOffCenter = 0;
      for (const ornament of doc.querySelectorAll<HTMLElement>(".scene-break")) {
        const parent = ornament.parentElement?.getBoundingClientRect();
        const rect = ornament.getBoundingClientRect();
        if (parent && Math.abs((rect.left + rect.right - parent.left - parent.right) / 2) > 1.5) ornamentalBreaksOffCenter++;
      }
      const dropcapParagraph = section?.querySelector<HTMLElement>(":scope > p.folio-composed-dropcap") ?? null;
      const dropcapOpening = [...(dropcapParagraph?.querySelectorAll<HTMLElement>(":scope > .folio-composed-line") ?? [])]
        .slice(0, 2).map((line) => ({ text: line.textContent ?? "", justified: line.classList.contains("folio-line-justified") }));
      const bodyFont = corpusParagraph ? getComputedStyle(corpusParagraph).fontFamily : "";
      const measurePx = Math.max(0, ...paragraphs.flatMap((paragraph) => [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")].map((line) => line.getBoundingClientRect().width)));
      return {
        paragraphCount: paragraphs.length,
        justifiedLines,
        hyphenatedLines,
        hyphenRate: hyphenatedLines / Math.max(1, justifiedLines),
        maxHyphenStreak,
        maxRightErrorPx,
        maxRightProtrusionPx,
        maxWordSpacingEm,
        maxStrictWordSpacingEm,
        maxRelaxedWordSpacingEm,
        relaxedLines,
        maxTrackingEm,
        maxGlyphScaleDelta,
        maxAdjacentGlyphScaleDelta,
        maxSemanticGapEm,
        maxAdjacentSpacingDeltaEm,
        emergencyLines,
        oneWordFinalLines,
        compositionFailures: compositionFailureDetails.length,
        compositionFailureDetails,
        emergencyDetails,
        ornamentalBreaksOffCenter,
        strandedEnglishArticleLine,
        dropcapCount: section?.querySelectorAll(":scope > p.folio-composed-dropcap").length ?? 0,
        dropcapOpening,
        bodyFont,
        measurePx,
      };
    }, { expected: needle, englishScenario: scenario === "en" });

    const failures: string[] = [];
    if (report.paragraphCount < 2) failures.push(`paragraphCount=${report.paragraphCount}`);
    if (report.justifiedLines < 6) failures.push(`justifiedLines=${report.justifiedLines}`);
    if (report.maxRightErrorPx > 1.75) failures.push(`maxRightErrorPx=${report.maxRightErrorPx}`);
    if (report.maxRightProtrusionPx > 4.51) failures.push(`maxRightProtrusionPx=${report.maxRightProtrusionPx}`);
    if (report.maxWordSpacingEm > 0.121) failures.push(`maxWordSpacingEm=${report.maxWordSpacingEm}`);
    if (report.maxStrictWordSpacingEm > 0.101) failures.push(`maxStrictWordSpacingEm=${report.maxStrictWordSpacingEm}`);
    if (report.maxRelaxedWordSpacingEm > 0.121) failures.push(`maxRelaxedWordSpacingEm=${report.maxRelaxedWordSpacingEm}`);
    if (report.relaxedLines > 2) failures.push(`relaxedLines=${report.relaxedLines}`);
    if (report.maxTrackingEm > 0.0031) failures.push(`maxTrackingEm=${report.maxTrackingEm}`);
    if (report.maxGlyphScaleDelta > 0.0101) failures.push(`maxGlyphScaleDelta=${report.maxGlyphScaleDelta}`);
    if (report.maxAdjacentGlyphScaleDelta > 0.0121) failures.push(`maxAdjacentGlyphScaleDelta=${report.maxAdjacentGlyphScaleDelta}`);
    if (report.maxSemanticGapEm > 0.37) failures.push(`maxSemanticGapEm=${report.maxSemanticGapEm}`);
    if (report.maxAdjacentSpacingDeltaEm > 0.16) failures.push(`maxAdjacentSpacingDeltaEm=${report.maxAdjacentSpacingDeltaEm}`);
    if (report.hyphenRate > 0.45) failures.push(`hyphenRate=${report.hyphenRate}`);
    if (report.maxHyphenStreak > 2) failures.push(`maxHyphenStreak=${report.maxHyphenStreak}`);
    if (report.emergencyLines !== 0) failures.push(`emergencyLines=${report.emergencyLines}`);
    if (report.oneWordFinalLines !== 0) failures.push(`oneWordFinalLines=${report.oneWordFinalLines}`);
    if (report.compositionFailures !== 0) failures.push(`compositionFailures=${report.compositionFailures}`);
    if (report.ornamentalBreaksOffCenter !== 0) failures.push(`ornamentalBreaksOffCenter=${report.ornamentalBreaksOffCenter}`);
    if (report.strandedEnglishArticleLine) failures.push(`strandedEnglishArticleLine=${JSON.stringify(report.strandedEnglishArticleLine)}`);
    if (expectDropcap && (report.dropcapCount < 1 || report.dropcapOpening.length < 2 || report.dropcapOpening.some((line) => !line.justified))) {
      failures.push(`dropcapOpening=${JSON.stringify(report.dropcapOpening)}`);
    }
    if (!expectDropcap && report.dropcapCount !== 0) failures.push(`unexpectedDropcaps=${report.dropcapCount}`);
    return { theme, label, scenario, pass: failures.length === 0, failures, metrics: { ...report, hyphenRateLimit: 0.45 } };
  };

  const themes = themeList();
  if (themes.length !== 30) throw new Error(`Expected exactly 30 release themes, found ${themes.length}`);
  const results: MatrixResult[] = [];

  await setLanguage("pl");
  await setDropcap(false);
  const polishNeedle = await replaceEditor(polish);
  for (const theme of themes) {
    await setTheme(theme.name);
    results.push(await measure(theme.name, theme.label, "pl", polishNeedle, false));
  }

  await setDropcap(true);
  for (const theme of themes) {
    await setTheme(theme.name);
    results.push(await measure(theme.name, theme.label, "pl-dropcap", polishNeedle, true));
  }

  await setLanguage("en");
  await setDropcap(false);
  const englishNeedle = await replaceEditor(english);
  for (const theme of themes) {
    await setTheme(theme.name);
    results.push(await measure(theme.name, theme.label, "en", englishNeedle, false));
  }

  const failed = results.filter((result) => !result.pass);
  const summary = {
    themes: themes.length,
    scenariosPerTheme: 3,
    totalScenarios: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failuresByTheme: Object.fromEntries(themes.map((theme) => [theme.name, failed.filter((result) => result.theme === theme.name).map((result) => ({ scenario: result.scenario, failures: result.failures }))]).filter(([, failures]) => (failures as unknown[]).length)),
    results,
  };
  await fs.writeFile(path.join(qa, "theme-matrix.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ themes: summary.themes, totalScenarios: summary.totalScenarios, passed: summary.passed, failed: summary.failed, failuresByTheme: summary.failuresByTheme }, null, 2));
  if (failed.length) throw new Error(`All-theme qualification failed ${failed.length}/${results.length} scenarios; see build/qa-v107/theme-matrix.json`);
} finally {
  await closeBrowser().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
