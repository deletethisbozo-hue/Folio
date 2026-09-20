import path from "node:path";
import { promises as fs } from "node:fs";
import { createSampleProject, loadProject, closeProject } from "../server/projects.ts";
import { renderPrintPreviewHtml } from "../server/pipeline/render-print.ts";
import { closeBrowser, getBrowser } from "../server/pipeline/render-pdf.ts";
import { DEFAULT_PRINT } from "../server/print.ts";
import type { ThemeName } from "../server/pipeline/types.ts";
import { ROOT } from "../server/pipeline/paths.ts";

const themes: ThemeName[] = ["amour","velvet","seance","memoir","gothic","scriptorium","arcana"];
const out = path.join(ROOT, "build", "qa-asset-themes");
await fs.mkdir(out, { recursive: true });

const projectId = createSampleProject();

try {
  const browser = await getBrowser();

  for (const theme of themes) {
    const { book } = await loadProject(projectId, { theme });
    const firstChapter = book.sections.find((section) => section.kind === "chapter");
    if (!firstChapter) throw new Error("Sample project has no chapter.");
    firstChapter.chapterNumber = 1;
    book.sections = [firstChapter];

    const { html, meta } = await renderPrintPreviewHtml(book, {
      ...DEFAULT_PRINT,
      trim: "6x9",
      startChaptersRecto: false,
      layout: "folio-bottom",
    });

    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 1.25 });
      await page.setContent(html, { waitUntil: "load" });
      const chapter = await page.$(".pagedjs_page.pagedjs_chapter_page");
      if (!chapter) throw new Error(`No paginated chapter page for ${theme}`);
      await chapter.screenshot({ path: path.join(out, `${theme}.png`) });

      const diagnostic = await page.evaluate(() => {
        const pageNode = document.querySelector<HTMLElement>(".pagedjs_page.pagedjs_chapter_page");
        const heading = pageNode?.querySelector<HTMLElement>("section.chapter > h1");
        const before = heading ? getComputedStyle(heading, "::before") : null;
        return {
          pageWidth: pageNode?.getBoundingClientRect().width ?? 0,
          pageHeight: pageNode?.getBoundingClientRect().height ?? 0,
          heading: heading?.textContent?.trim() ?? "",
          ornamentBackground: before?.backgroundImage ?? "",
        };
      });
      await fs.writeFile(path.join(out, `${theme}.json`), JSON.stringify({ theme, pages: meta.pages, ...diagnostic }, null, 2));
    } finally {
      await page.close();
    }
  }
} finally {
  await closeProject(projectId);
  await closeBrowser();
}
