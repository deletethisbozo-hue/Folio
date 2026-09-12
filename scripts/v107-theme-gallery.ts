import express from "express";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { promises as fs } from "node:fs";
import { registerApi } from "../server/api.ts";
import { registerEditorApi } from "../server/editor-api.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { ROOT } from "../server/pipeline/paths.ts";
import { themeList } from "../server/pipeline/themes.ts";

const qa = path.join(ROOT, "build", "qa-v107", "theme-gallery");
await fs.mkdir(qa, { recursive: true });

const paragraphs = [
  "Poczucie bezsensowności było o wiele większym brzemieniem niż brak zasobów. Porażka — nic więcej jak przygnębiająca. Z jego perspektywy życie nie było wyborem, tylko konsekwencją wszystkich przemilczanych decyzji.",
  "Niektórzy w mieście chcieli jego śmierci za rzeczy, których nigdy nie uczynił. Profesjonalny skład książki powinien zachowywać równy rytm, rozsądne dzielenie wyrazów oraz spokojną szarość typograficzną bez rzek bieli.",
  "— Czy naprawdę możemy tam wrócić? — zapytała. — Możemy, ale nie powinniśmy udawać, że niczego się nie boimy. Najtrudniejsze odpowiedzi przychodzą przecież dopiero wtedy, gdy kończą się wszystkie łatwe pytania.",
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

type GalleryEntry = {
  theme: string;
  label: string;
  file: string;
  bodyFont: string;
  headingFont: string;
  dropcap: boolean;
};

try {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Open Sample"));
    if (!button) throw new Error("Open Sample is missing");
    (button as HTMLButtonElement).click();
  });
  await page.waitForSelector('.rich-editor[contenteditable="true"]');
  await page.waitForSelector(".preview-loading", { hidden: true });

  const settle = async () => {
    await page.waitForSelector(".preview-loading", { hidden: true });
    await page.waitForFunction(() => {
      const doc = document.querySelector("iframe")?.contentDocument;
      return Boolean(doc?.querySelector("section.chapter > p.folio-composed .folio-composed-line"));
    });
    await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.fonts?.status === "loaded");
    await sleep(350);
  };

  const setLanguage = async () => {
    await page.click('[data-command="book"]');
    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]');
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".dialog-field")].find((node) => node.querySelector("span")?.textContent === "Language");
      const input = row?.querySelector("input") as HTMLInputElement | null;
      if (!input) throw new Error("Language field is missing");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "pl");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const save = [...document.querySelectorAll(".folio-dialog footer button")].find((node) => node.textContent === "Save");
      (save as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForSelector('.folio-dialog[aria-label="Book Details"]', { hidden: true });
    await settle();
  };

  const replaceEditor = async () => {
    await page.$eval(".rich-editor", (element, values) => {
      const editor = element as HTMLElement;
      const ornament = '<div class="editor-scene-break" data-scene-break="true" contenteditable="false"><span>⁂</span><button type="button" class="editor-scene-break-remove">×</button></div>';
      editor.innerHTML = values.map((value) => `<p>${value}</p>`).join(ornament);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    }, paragraphs);
    await page.waitForFunction((needle) => (document.querySelector(".rich-editor") as HTMLElement)?.dataset.markdown?.includes(needle), {}, paragraphs[0].slice(0, 48));
    await settle();
  };

  const setTheme = async (theme: string) => {
    await page.click('[data-command="design"]');
    await page.waitForSelector('.style-library[aria-label="Book style library"]');
    await page.evaluate(() => {
      const button = [...document.querySelectorAll(".style-category-list button")].find((node) => node.textContent === "Book Style");
      (button as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForSelector(`[data-theme="${theme}"]`);
    await page.click(`[data-theme="${theme}"]`);
    await page.waitForFunction((value) => document.querySelector(`[data-theme="${value}"]`)?.classList.contains("selected"), {}, theme);
    await page.click(".style-library-header button");
    await page.waitForSelector('.style-library[aria-label="Book style library"]', { hidden: true });
    await settle();
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
    await settle();
  };

  await setLanguage();
  await replaceEditor();
  const entries: GalleryEntry[] = [];
  const themes = themeList();
  for (let index = 0; index < themes.length; index++) {
    const theme = themes[index];
    await setTheme(theme.name);
    await setDropcap(theme.dropcap);
    await page.evaluate(() => {
      const doc = document.querySelector("iframe")?.contentDocument;
      doc?.querySelector("section.chapter")?.scrollIntoView({ block: "start" });
    });
    await sleep(200);
    const fonts = await page.evaluate(() => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const body = doc.querySelector<HTMLElement>("section.chapter > p.folio-composed");
      const heading = doc.querySelector<HTMLElement>("section.chapter > h1, h1.chapter");
      return {
        bodyFont: body ? getComputedStyle(body).fontFamily : "",
        headingFont: heading ? getComputedStyle(heading).fontFamily : "",
      };
    });
    const file = `${String(index + 1).padStart(2, "0")}-${theme.name}.png`;
    const screen = await page.$(".reader-screen");
    if (!screen) throw new Error("Reader screen is missing");
    await screen.screenshot({ path: path.join(qa, file) });
    entries.push({ theme: theme.name, label: theme.label, file, ...fonts, dropcap: theme.dropcap });
    console.log(`[theme-gallery] ${theme.label}: ${fonts.bodyFont} / ${fonts.headingFont}`);
  }

  await fs.writeFile(path.join(qa, "manifest.json"), JSON.stringify(entries, null, 2) + "\n", "utf8");
  const cards = entries.map((entry) => `
    <article><img src="${entry.file}" alt="${entry.label}"><div><strong>${entry.label}</strong><span>${entry.bodyFont}</span><span>${entry.headingFont}</span></div></article>`).join("\n");
  await fs.writeFile(path.join(qa, "index.html"), `<!doctype html><meta charset="utf-8"><title>Folio 1.0.7 theme gallery</title><style>
body{margin:0;padding:32px;background:#171716;color:#f3f1eb;font:14px/1.45 system-ui,sans-serif}h1{margin:0 0 24px;font-size:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px}article{background:#252522;border:1px solid #3a3934;border-radius:12px;overflow:hidden}img{display:block;width:100%;height:auto;background:#ddd}article div{display:grid;gap:4px;padding:12px 14px}strong{font-size:16px}span{color:#aaa79f;font-size:12px;overflow-wrap:anywhere}</style><h1>Folio 1.0.7 · 30-theme typography gallery</h1><main class="grid">${cards}</main>`, "utf8");
} finally {
  server.close();
  await closeBrowser();
}
