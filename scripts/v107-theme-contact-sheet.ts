import path from "node:path";
import { promises as fs } from "node:fs";
import { ROOT } from "../server/pipeline/paths.ts";
import { themeList } from "../server/pipeline/themes.ts";
import { buildThemeRuntimeCss } from "../server/pipeline/theme-fonts.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";

const out = path.join(ROOT, "build", "qa-v107", "theme-contact-sheet");
await fs.mkdir(out, { recursive: true });
const baseCss = await fs.readFile(path.join(ROOT, "themes", "base.css"), "utf8");

const paragraph1 = "Poczucie bezsensowności było o wiele większym brzemieniem niż brak zasobów. Porażka — nic więcej jak przygnębiająca. Z jego perspektywy życie nie było wyborem, tylko konsekwencją wszystkich przemilczanych decyzji.";
const paragraph2 = "Niektórzy w mieście chcieli jego śmierci za rzeczy, których nigdy nie uczynił. Profesjonalny skład książki powinien zachowywać równy rytm, rozsądne dzielenie wyrazów oraz spokojną szarość typograficzną bez rzek bieli.";

function firstParagraph(dropcap: boolean): string {
  if (!dropcap) return `<p>${paragraph1}</p>`;
  return `<p><span class="dropcap">${paragraph1[0]}</span>${paragraph1.slice(1)}</p>`;
}

const themes = themeList();
const manifest: Array<{theme:string;label:string;file:string;dropcap:boolean;bodyFont:string;headingFont:string}> = [];
const browser = await getBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 760, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20_000);

  for (let i = 0; i < themes.length; i++) {
    const theme = themes[i];
    const runtime = await buildThemeRuntimeCss(theme.name, "print");
    const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${baseCss}\n${runtime.css}\nhtml{background:#e6e1d8}body{margin:0!important;padding:0!important;background:#e6e1d8!important}.preview-card{width:412px;min-height:680px;margin:20px auto;background:${theme.previewPaper};box-shadow:0 10px 28px rgba(0,0,0,.14);overflow:hidden}.preview-card main.book{box-sizing:border-box;max-width:none;width:100%;min-height:680px;padding:36px 34px 50px;background:transparent}.preview-card section.level1{margin-top:0!important;border-top:0!important;padding-top:0!important;break-before:auto!important;page-break-before:auto!important}.preview-card p{font-size:16px}.preview-card h1{margin-top:0}</style></head><body><div class="preview-card"><main class="book"><section class="chapter level1"><h1>Miasto po deszczu</h1>${firstParagraph(theme.dropcap)}<p>${paragraph2}</p><p class="scene-break">${theme.sceneOrnament}</p><p>— Czy naprawdę możemy tam wrócić? — zapytała. — Możemy, ale nie powinniśmy udawać, że niczego się nie boimy.</p></section></main></div></body></html>`;
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; });
    const fonts = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>("section.chapter > p");
      const heading = document.querySelector<HTMLElement>("section.chapter > h1");
      return { bodyFont: body ? getComputedStyle(body).fontFamily : "", headingFont: heading ? getComputedStyle(heading).fontFamily : "" };
    });
    const file = `${String(i + 1).padStart(2, "0")}-${theme.name}.png`;
    const card = await page.$(".preview-card");
    if (!card) throw new Error("preview-card missing");
    await card.screenshot({ path: path.join(out, file) });
    manifest.push({ theme: theme.name, label: theme.label, file, dropcap: theme.dropcap, ...fonts });
    console.log(`[contact-sheet] ${String(i + 1).padStart(2, "0")}/30 ${theme.label} :: ${fonts.bodyFont} / ${fonts.headingFont}`);
  }
  await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
} finally {
  await closeBrowser();
}
