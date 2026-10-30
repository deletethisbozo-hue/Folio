import type { Book, ThemeLabImage } from "./types.ts";
import { getBrowser } from "./render-pdf.ts";

/**
 * PDF/X-3 forbids transparency, so Ghostscript flattens every page that holds
 * an alpha image or opacity, turning all text on that page into outlines. Bake
 * the opacity and alpha of the theme-lab images onto white first so those pages
 * keep real, searchable text. Only the PDF/X path uses this.
 */
export async function flattenThemeImagesForPdfX(book: Book): Promise<Book> {
  const lab = book.typography?.themeLab;
  if (!lab) return book;
  const keys = (["chapterOrnament", "sceneImage"] as const).filter((key) => lab[key]?.dataUrl);
  if (!keys.length) return book;
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const next = { ...lab };
    for (const key of keys) {
      const image = lab[key] as ThemeLabImage;
      const flattened = await page.evaluate(async (dataUrl, opacity) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = opacity; ctx.drawImage(img, 0, 0);
        return canvas.toDataURL("image/png");
      }, image.dataUrl as string, Math.min(1, Math.max(0.1, image.opacity ?? 1)));
      next[key] = { ...image, dataUrl: flattened, opacity: 1 };
    }
    return { ...book, typography: { ...book.typography, themeLab: next } };
  } finally { await page.close().catch(() => undefined); }
}
